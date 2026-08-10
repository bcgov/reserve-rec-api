const { logger, sendResponse, Exception } = require("/opt/base");
const { fetchProductDates, fetchProductDateByDate } = require("../../methods");

exports.handler = async (event, context) => {
  logger.info("GET Product Dates", event);

   // Allow CORS
    if (event.httpMethod === "OPTIONS") {
      return sendResponse(200, {}, "Success", null, context);
    }

  try {

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("collectionId, activityType, activityId, and productId are required in the path", { code: 400 });
    }

    // Support both single date and date range queries
    // If 'date' is provided, use it for both startDate and endDate (single day query)
    // Otherwise use startDate and endDate for range queries
    let startDate = event?.queryStringParameters?.date || event?.queryStringParameters?.startDate || null;
    let endDate = event?.queryStringParameters?.date || event?.queryStringParameters?.endDate || null;

    let bypassDiscoveryRules = event?.queryStringParameters?.bypassDiscoveryRules && event.queryStringParameters.bypassDiscoveryRules === 'true' ? true : false;

    // If startDate and endDate are not provided, we will return the next two weeks of ProductDates for the Product by default. This is to prevent accidentally returning a huge amount of data if someone forgets to provide a date range.

    if (!startDate) {
      const today = new Date();
      const twoWeeksFromToday = new Date(today);
      twoWeeksFromToday.setDate(today.getDate() + 14);
      startDate = today.toISOString().split('T')[0];
      endDate = twoWeeksFromToday.toISOString().split('T')[0];
    } else if (!endDate) {
      endDate = startDate;
    }

    logger.debug(`Fetching Product Dates for Product ${collectionId}::${activityType}::${activityId}::${productId} with startDate ${startDate} and endDate ${endDate}. Bypass discovery rules: ${bypassDiscoveryRules}`);

    const props = {
      collectionId: collectionId,
      activityType: activityType,
      activityId: activityId,
      productId: productId,
      startDate: startDate,
      endDate: endDate,
      bypassDiscoveryRules: bypassDiscoveryRules,
    }

    // Check if this is a single date query
    const date = startDate === endDate ? startDate : null;
    
    let productDates;
    if (date) {
      logger.debug(`Single date query detected - using fetchProductDateByDate for ${date}`);
      productDates = await fetchProductDateByDate({
        collectionId,
        activityType,
        activityId,
        productId,
        date,
        bypassDiscoveryRules
      });
    } else {
      logger.debug(`Range query - using fetchProductDates from ${startDate} to ${endDate}`);
      productDates = await fetchProductDates(props);
    }

    return sendResponse(200, productDates, "Success", null, context);

  } catch (error) {
    logger.error("Error fetching Product Dates", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};