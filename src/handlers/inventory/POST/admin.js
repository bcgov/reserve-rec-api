const { quickApiPutHandler, formatForQuickApi } = require("../../../common/data-utils");
const { logger, sendResponse, Exception } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");
const { INVENTORY_API_PUT_CONFIG } = require("../configs");
const { initializeInventory } = require("../methods");

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

exports.handler = async (event, context) => {
  logger.info("POST Inventory by Product", event);

  try {
    // Validate required parameters from path, queryparams, and body.

    const body = JSON.parse(event?.body);

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    // Start and end dates make up the date range and should optionally from the event body
    // At least a startdate must be provided.

    let startDate = event?.queryStringParameters?.startDate || body?.startDate || null;
    let endDate = event?.queryStringParameters?.endDate || body?.endDate || null;
    const skipWarnings = event?.queryStringParameters?.skipWarnings === 'true' || body?.skipWarnings === true || false;

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Missing required path parameters: collectionId, activityType, activityId, productId");
    }

    if (!startDate) {
      throw new Exception("Missing required query parameter: startDate");
    }

    if (!endDate) {
      endDate = startDate; // If no end date is provided, we will just create inventory for the start date
    }

    const [inventoryToCreate, successes, failures] = await initializeInventory(collectionId, activityType, activityId, productId, startDate, endDate);

    if (failures?.length > 0 && !skipWarnings) {
      logger.warn(`Failed to initialize inventory for ${failures.length} product dates. Use skipWarnings=true to skip this warning.`, {
        failures,
      });
      return sendResponse(
        207,
        {
          successes: successes?.length || 0,
          failures: failures?.length || 0,
          failureData: failures
        },
        "Inventory initialization completed with some failures. Check the failureData array for details.",
        null,
        context
      );
    }

    const inventoryPutItems = await quickApiPutHandler(
      REFERENCE_DATA_TABLE_NAME,
      formatForQuickApi(inventoryToCreate),
      INVENTORY_API_PUT_CONFIG
    );

    logger.debug(`Creating ${inventoryPutItems.length} inventory records for product ${productId} from ${startDate} to ${endDate}`);

    // Batch write them to DynamoDB
    let attempt = 0;
    let success = false;
    while (attempt <= MAX_RETRIES && !success) {
      attempt++;
      try {
        await batchTransactData(inventoryPutItems);
        success = true;
      } catch (error) {
        if (attempt > MAX_RETRIES) {
          throw new Exception("Failed to write inventory records to DynamoDB after multiple attempts", {
            error,
          });
        }
        logger.error(`Error writing inventory records to DynamoDB on attempt ${attempt}`, error);
        await new Promise(resolve => setTimeout(resolve, attempt * RETRY_DELAY_MS));
      }
    }

    logger.info(`Successfully initialized inventory for product ${productId} from ${startDate} to ${endDate}. Created ${inventoryPutItems.length} inventory records.`);

    return sendResponse(
      200,
      [],
      `Successfully initialized ${inventoryPutItems.length} inventory records for product ${productId} from ${startDate} to ${endDate}`,
      null,
      context
    );

  } catch (error) {
    logger.error("Error in POST Inventory", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || error.message || "Error",
      error?.error || error,
      context
    );
  }
}