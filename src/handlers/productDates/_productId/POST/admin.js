const { logger, sendResponse, Exception } = require("/opt/base");
const { initializeProductDates } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");
const { quickApiPutHandler, formatForQuickApi } = require("../../../../common/data-utils");
const { PRODUCTDATE_API_PUT_CONFIG, AVAILABILITYSIGNAL_API_PUT_CONFIG } = require("../../configs");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

exports.handler = async (event, context) => {
  logger.info("POST Product Dates", event);
  try {

    // Validate required parameters from body.
    // We need a Product and a date range to create ProductDates
    // We need a collectionId, activityType, activityId, and productId to identify the Product
    // These should all come from the event path

    const body = JSON.parse(event?.body);

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    // Start and end dates make up the date range and should optionally from the event body
    // If not provided, we will use the Product's rangeStart and rangeEnd properties.

    const startDate = body?.startDate || null;
    const endDate = body?.endDate || null;

    // Initialize ProductDates

    const { productDates, availabilitySignals } = await initializeProductDates(collectionId, activityType, activityId, productId, startDate, endDate);

    // Use quickApiPutHandler to create the put items

    // TODO Turn off developerMode and properly vet the incoming data before writing to DynamoDB. For now, developerMode allows us to skip some validation and write directly to DynamoDB for faster testing.
    const productDatesPutItems = await quickApiPutHandler(
      REFERENCE_DATA_TABLE_NAME,
      formatForQuickApi(productDates),
      PRODUCTDATE_API_PUT_CONFIG
    );

    // TODO Turn off developerMode and properly vet the incoming data before writing to DynamoDB. For now, developerMode allows us to skip some validation and write directly to DynamoDB for faster testing.
    const availabilitySignalsPutItems = await quickApiPutHandler(
      REFERENCE_DATA_TABLE_NAME,
      formatForQuickApi(availabilitySignals),
      AVAILABILITYSIGNAL_API_PUT_CONFIG
    );

    // Shuffle them together like Shaggy would shuffle a loaf of bread and an entire salami - one from each at a time
    // We want to write them in the same transaction to ensure they are always in sync. If we wrote all ProductDates first and then all AvailabilitySignals, there is an increased risk that something could go wrong in between and we would end up with ProductDates but no AvailabilitySignals, which could cause issues for our application.

    const itemCount = productDatesPutItems.length;

    const allPutItems = [];
    while (productDatesPutItems.length > 0) {
      allPutItems.push(productDatesPutItems.shift());
      allPutItems.push(availabilitySignalsPutItems.shift());
    }

    logger.info(`Prepared ${allPutItems.length} items for batch writing to DynamoDB (ProductDates and AvailabilitySignals)`);

    // Batch write them to DynamoDB
    let attempt = 0;
    let success = false;
    while (attempt <= MAX_RETRIES && !success) {
      attempt++;
      try {
        await batchTransactData(allPutItems);
        success = true;
        logger.info(`Successfully wrote ProductDates and AvailabilitySignals to DynamoDB on attempt ${attempt}`);
      }
      catch (error) {
        if (attempt > MAX_RETRIES) {
          logger.error(`Failed to write ProductDates and AvailabilitySignals after ${MAX_RETRIES} attempts`, error);
          throw error;
        }
        logger.warn(`Attempt ${attempt} failed to write ProductDates and AvailabilitySignals. Retrying in ${RETRY_DELAY_MS}ms...`, error);
        await new Promise(resolve => setTimeout(resolve, attempt * RETRY_DELAY_MS));
      }
    }

    return sendResponse(200, [], `Successfully initialized ${itemCount} ProductDates for Product ${productId} with activity ${activityType} ${activityId}`, null, context);

  } catch (error) {
    logger.error("Error in POST Product Dates", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || error.message || "Error",
      error?.error || error,
      context
    );
  }
};

