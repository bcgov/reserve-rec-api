
const { fetchProductDates, fetchProductDateByDate } = require("../../methods");
const { PUBLIC_PRODUCTDATE_PROJECTIONS } = require("../../configs");
const { logger, sendResponse, Exception } = require("/opt/base");
/**
 * Fetches available ProductDates from a public user perspective. This means that discovery rules will ALWAYS be applied to the query, and only ProductDates that are discoverable to the user will be returned.
 */

exports.handler = async (event, context) => {
  logger.info("GET Product Dates - Public Handler", event);
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

    // Also enforce a maximum date range of 1 month to prevent excessively large queries.

    const start = new Date(startDate);
    const end = new Date(endDate);
    const maxEndDate = new Date(start);
    maxEndDate.setMonth(maxEndDate.getMonth() + 1);

    if (end > maxEndDate) {
      logger.warn(`End date ${endDate} is more than 1 month after start date ${startDate}. Adjusting end date to 1 month ahead maximum.`);
      endDate = maxEndDate.toISOString().split('T')[0];
    }

    const props = {
      collectionId: collectionId,
      activityType: activityType,
      activityId: activityId,
      productId: productId,
      startDate: startDate,
      endDate: endDate,
      bypassDiscoveryRules: false, // Discovery rules are ALWAYS applied for the public handler
      projectionFields: PUBLIC_PRODUCTDATE_PROJECTIONS, // We will only return a limited set of fields for the public handler to minimize data exposure
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
        bypassDiscoveryRules: false
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