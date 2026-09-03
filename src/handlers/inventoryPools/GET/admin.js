const { logger, sendResponse, Exception } = require("/opt/base");
const { fetchInventoryPoolsOnDate, fetchInventoryPoolsForDateRange } = require("../methods");
const { countCheckedInBookingsByDate } = require("../../bookings/methods");

exports.handler = async (event, context) => {
  logger.info("GET InventoryPool by Product on Date", event);

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,OPTIONS'
      },
      body: ''
    };
  }

  try {

    // Validate required parameters from path and queryparams

    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;
 
    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Missing required path parameters: collectionId, activityType, activityId, productId");
    }

    // Check if requesting by date range or single date
    const startDate = event?.queryStringParameters?.startDate || null;
    const endDate = event?.queryStringParameters?.endDate || null;
    const date = event?.queryStringParameters?.date || null;

    // Validate optional parameters
    const facilityType = event?.queryStringParameters?.facilityType || null;
    const facilityId = event?.queryStringParameters?.facilityId || null;
    const assetType = event?.queryStringParameters?.assetType || null;
    const assetId = event?.queryStringParameters?.assetId || null;
    const inventoryId = event?.queryStringParameters?.inventoryId || null;
    const allocationStatus = event?.queryStringParameters?.allocationStatus || null;
    const limit = event?.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : null;

    // The capacity calendar needs a checked-in tally beside Passes and
    // Reserved. Opt-in so callers that only want capacity don't pay for the
    // bookings query (bcgov/reserve-rec-admin#391).
    const includeCheckedIn = event?.queryStringParameters?.includeCheckedIn === 'true';

    let inventoryPools;

     if (startDate && endDate) {
      logger.debug(`Fetching InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);
      inventoryPools = await fetchInventoryPoolsForDateRange({ 
        collectionId, 
        activityType, 
        activityId, 
        productId, 
        startDate,
        endDate,
        facilityType, 
        facilityId, 
        assetType, 
        assetId, 
        inventoryId
      });
      logger.debug(`Fetched ${inventoryPools.length} InventoryPools from ${startDate} to ${endDate}`);
    } 
    // Otherwise, fetch for single date
    else if (date) {
      logger.debug(`Fetching InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} on date ${date}`);
      inventoryPools = await fetchInventoryPoolsOnDate({ 
        collectionId, 
        activityType, 
        activityId, 
        productId, 
        date, 
        facilityType, 
        facilityId, 
        assetType, 
        assetId, 
        inventoryId, 
        allocationStatus, 
        limit 
      });
      logger.debug(`Fetched ${inventoryPools.length} InventoryPools on date ${date}`);
    }
    // If neither date nor date range provided, throw error
    else {
      throw new Exception("Must provide either 'date' for a single date or 'startDate' and 'endDate' for a date range");
    }

    logger.debug(`Fetched InventoryPools for ${collectionId}::${activityType}::${activityId}::${productId} on date ${date}. ${inventoryPools.length} items found.`);

    if (includeCheckedIn && inventoryPools.length) {
      inventoryPools = await withCheckedInCounts(inventoryPools, {
        collectionId,
        activityType,
        activityId,
        productId,
        startDate,
        endDate,
        date,
      });
    }

    return sendResponse(200, inventoryPools, "Success", null, context);

  } catch (error) {
    logger.error("Error fetching InventoryPools", error);
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
 * Attach checkedInCount to each pool for its own date. A date with no
 * check-ins gets 0 rather than being left undefined, so the caller can tell
 * "none checked in" apart from "not counted" — the calendar shows NA for the
 * latter (bcgov/reserve-rec-admin#391).
 *
 * A failure here must not cost the caller its capacity data, so the counts are
 * best-effort: on error the pools are returned unannotated.
 */
async function withCheckedInCounts(pools, { collectionId, activityType, activityId, productId, startDate, endDate, date }) {
  const from = startDate || date;
  const to = endDate || date;

  try {
    const counts = await countCheckedInBookingsByDate({
      collectionId,
      activityType,
      activityId,
      productId,
      startDate: from,
      endDate: to,
    });

    return pools.map((pool) => ({
      ...pool,
      checkedInCount: counts[pool.date] ?? 0,
    }));
  } catch (error) {
    logger.error("Could not count checked-in bookings; returning pools without counts", {
      error: error?.message || String(error),
    });
    return pools;
  }
}
