const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { GEOZONE_API_UPDATE_CONFIG } = require("/opt/geozones/configs");
const { validateSortKey } = require("/opt/geozones/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /geozones/{gzCollectionId} PUT
 * Update Geozones
 */
exports.handler = async (event, context) => {
  logger.info("PUT Geozones", event);
  try {
    const gzCollectionId = event?.pathParameters?.gzcollectionid;
    const body = JSON.parse(event?.body);

    if (!gzCollectionId) {
      throw new Exception("gzCollectionId is required", { code: 400 });
    }

    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the geozoneId if provided
    const { geozoneId } = event?.queryStringParameters || {};
    let updateRequests = [];
    // Check if the request is a batch request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        updateRequests.push(processItem(gzCollectionId, geozoneId, sk, item));
      }
    } else {
      const { sk } = body;
      updateRequests.push(processItem(gzCollectionId, geozoneId, sk, body));
    }

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      TABLE_NAME,
      updateRequests,
      GEOZONE_API_UPDATE_CONFIG
    );

    // Use batchTransactData to update the database
    const res = await batchTransactData(updateItems);

    return sendResponse(200, res, "Success", null, context);
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

function processItem(gzCollectionId, geozoneId, sk, item) {
  validateSortKey(geozoneId, sk);
  return createPutCommand(gzCollectionId, geozoneId, sk, item);
}

function createPutCommand(gzCollectionId, geozoneId, sk, item) {
  const pk = `geozone::${gzCollectionId}`;
  sk = sk ? sk : `${geozoneId}`;

  // Remove pk, sk, geozoneId as these can't be updated
  delete item.pk;
  delete item.sk;
  delete item.geozoneId;

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}
