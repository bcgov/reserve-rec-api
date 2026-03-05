
const { logger, sendResponse, Exception } = require("/opt/base");
const { deleteInventory } = require("../methods");

exports.handler = async (event, context) => {
  logger.info("DELETE Inventory by Product", event);
  try {

    const body = JSON.parse(event?.body);

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("collectionId, activityType, activityId, and productId are required in the path", { code: 400 });
    }

    let startDate = event?.queryStringParameters?.startDate || body?.startDate || null;
    let endDate = event?.queryStringParameters?.endDate || body?.endDate || null;

    if (!endDate) {
      endDate = startDate;
    }

    const props = {
      collectionId,
      activityType,
      activityId,
      productId,
      startDate,
      endDate,
    };

    const deletedItemCount = await deleteInventory(props);

    return sendResponse(200, null, `Inventory deleted successfully. Total deleted: ${deletedItemCount}`, null, context);

  } catch (error) {
    logger.error("Error deleting Inventory", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};