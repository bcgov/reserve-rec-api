const { logger, sendResponse, Exception } = require("/opt/base");
const { initializeProductDates, fetchProductDates } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");
const { quickApiPutHandler, formatForQuickApi } = require("../../../../common/data-utils");
const { PRODUCTDATE_API_PUT_CONFIG } = require("../../configs");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

exports.handler = async (event, context) => {
  logger.info("POST Product Dates", event);

  // Allow Options
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {

    // Validate required parameters from query string and path
    // We need a Product and a date range to create ProductDates
    // We need a collectionId, activityType, activityId, and productId to identify the Product
    // These should all come from the event path

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    // Start and end dates come from query parameters, not the body
    // If not provided, we will use the Product's rangeStart and rangeEnd properties.

    const startDate = event?.queryStringParameters?.startDate || null;
    const endDate = event?.queryStringParameters?.endDate || null;

    // Initialize ProductDates

    const productDates = await initializeProductDates(collectionId, activityType, activityId, productId, startDate, endDate);

    // Use quickApiPutHandler to create the put items

    if (!productDates || productDates.length === 0) {
      logger.warn(`No ProductDates were initialized for Product ${productId} with activity ${activityType} ${activityId} between dates ${startDate} and ${endDate}. Nothing to write to DynamoDB.`);
      return sendResponse(200, [], `No ProductDates were initialized for Product ${productId} with activity ${activityType} ${activityId} between dates ${startDate} and ${endDate}. Nothing was written to DynamoDB.`, null, context);
    }

    // TODO Turn off developerMode and properly vet the incoming data before writing to DynamoDB. For now, developerMode allows us to skip some validation and write directly to DynamoDB for faster testing.
    const productDatesPutItems = await quickApiPutHandler(
      REFERENCE_DATA_TABLE_NAME,
      formatForQuickApi(productDates),
      PRODUCTDATE_API_PUT_CONFIG
    );

    logger.info(`Prepared ${productDatesPutItems.length} items for batch writing to DynamoDB (ProductDates)`);

    // Batch write them to DynamoDB
    let attempt = 0;
    let success = false;
    const createdProductDates = [];
    
    while (attempt <= MAX_RETRIES && !success) {
      attempt++;
      try {
        await batchTransactData(productDatesPutItems);
        success = true;
        logger.info(`Successfully wrote ProductDates to DynamoDB on attempt ${attempt}`);
        createdProductDates.push(...productDates);
      }
      catch (error) {
        const errorMessage = error?.message || '';
        
        // ConditionalCheckFailed means items already exist - that's acceptable, not an error
        if (errorMessage.includes('ConditionalCheckFailed')) {
          logger.info(`ProductDates already exist (ConditionalCheckFailed). Items already exist in database - returning prepared items.`);
          // When ConditionalCheckFailed occurs, it means the items we tried to write already exist.
          // Rather than querying (which may fail due to eventually-consistent read timing),
          // we simply return the items we prepared, since we know they're in the database now.
          createdProductDates.push(...productDates);
          success = true;
        } else {
          // Other errors - retry with backoff
          if (attempt > MAX_RETRIES) {
            logger.error(`Failed to write ProductDates after ${MAX_RETRIES} attempts`, error);
            throw error;
          }
          logger.warn(`Attempt ${attempt} failed to write ProductDates. Retrying in ${attempt * RETRY_DELAY_MS}ms...`, error);
          await new Promise(resolve => setTimeout(resolve, attempt * RETRY_DELAY_MS));
        }
      }
    }

    const resultDates = createdProductDates.length > 0 ? createdProductDates : productDates;
    return sendResponse(200, resultDates, `Successfully prepared ${resultDates.length} ProductDates for Product ${productId} with activity ${activityType} ${activityId}`, null, context);

  } catch (error) {
    logger.error("Error in POST Product Dates", error);
    // Avoid circular reference errors by not passing the full error object
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Failed to create ProductDates",
      null,
      context
    );
  }
};