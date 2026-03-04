const { logger, sendResponse, Exception } = require("/opt/base");
const { deleteProductDates } = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("DELETE Product Dates", event);
  try {

    const body = JSON.parse(event?.body);

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("collectionId, activityType, activityId, and productId are required in the path", { code: 400 });
    }

    const startDate = body?.startDate || null;
    const endDate = body?.endDate || null;

    const deletedItemCount = await deleteProductDates(collectionId, activityType, activityId, productId, startDate, endDate);

    return sendResponse(200, null, `Product Dates deleted successfully. Total deleted: ${deletedItemCount}`, null, context);

  } catch (error) {
    logger.error("Error deleting Product Dates", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
}