const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { quickApiUpdateHandler } = require("../../../../common/data-utils");
const { PRODUCT_API_UPDATE_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");
const { syncAssetListToProductDates } = require("../../../productDates/methods");
const { syncCapacityToInventoryPools } = require("../../../inventoryPools/methods");

/**
 * @api {put} /products/{collectionId} PUT
 * Update Products
 */
exports.handler = async (event, context) => {
  logger.info("PUT Products", event);
  try {
    const authContext = checkAuthContext(event, "staff");

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || null;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || null;
    const productId = event?.pathParameters?.productId || event?.queryStringParameters?.productId || null;
    const body = JSON.parse(event?.body);

    // Validate required parameters
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!collectionId) missingParams.push("collectionId");
    
    if (missingParams.length > 0) {
      throw new Exception(
        `Cannot create product - missing required parameter(s): ${missingParams.join(", ")}`,
        { code: 400 }
      );
    }

    // If body is an array, validate each item has required fields
    if (body.length > 0) {
      for (const item of body) {
        if (!item.activityType || !item.activityId || !item.productId) {
          throw new Error("Each item in body must include activityType, activityId, and productId");
        }
      }
    }

    let updateRequests = await parseRequest(collectionId, body, "PUT", activityType, activityId, productId);

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      REFERENCE_DATA_TABLE_NAME,
      updateRequests,
      PRODUCT_API_UPDATE_CONFIG
    );

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    // ProductDates and InventoryPools snapshot the Product's assetList, so an assetList
    // change has to be pushed down to them or the two will drift apart.
    for (const updateRequest of updateRequests) {
      if (!updateRequest?.data?.assetList) {
        continue;
      }

      await cascadeAssetList({
        collectionId,
        pk: updateRequest?.key?.pk,
        productId: updateRequest?.key?.sk,
        assetList: updateRequest.data.assetList,
        timezone: updateRequest?.data?.timezone
      });
    }

    return sendResponse(200, updateRequests, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};

/**
 * Pushes a Product's new assetList down to its future ProductDates and their InventoryPools.
 *
 * Failures here are logged but not thrown: the Product update itself has already been
 * committed, and failing the request would tell the caller the edit did not happen.
 */
async function cascadeAssetList({ collectionId, pk, productId, assetList, timezone }) {
  try {
    // pk is "product::<collectionId>::<activityType>::<activityId>"
    const [, , activityType, activityId] = String(pk).split("::");

    const updatedDates = await syncAssetListToProductDates({
      collectionId,
      activityType,
      activityId,
      productId,
      assetList,
      ...(timezone && { timezone })
    });

    await syncCapacityToInventoryPools({
      collectionId,
      activityType,
      activityId,
      productId,
      dates: updatedDates,
      assetList
    });
  } catch (error) {
    logger.error(`Failed to cascade assetList for product ${pk}::${productId}`, error);
  }
}
