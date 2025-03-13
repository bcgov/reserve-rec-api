const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("/opt/data-utils");
const { FACILITY_API_PUT_CONFIG } = require("/opt/facilities/configs");
const { validateSortKey } = require("/opt/facilities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {post} /facilities/{orcs} POST
 * Create Facilities
 */
exports.handler = async (event, context) => {
  logger.info("POST Facilities", event);
  try {
    const orcs = String(event?.pathParameters?.orcs);

    if (!orcs) {
      throw new Exception("ORCS is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { facilityType, facilityId } = event?.queryStringParameters || {};
    let postRequests = [];
    // Process batch request or a single request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        postRequests.push(processItem(orcs, facilityType, facilityId, sk, item));
      }
    } else {
      const { sk } = body;
      postRequests.push(processItem(orcs, facilityType, facilityId, sk, body));
    }

    // Use quickApiPutHandler to create the put items
    const putItems = await quickApiPutHandler(
      TABLE_NAME,
      postRequests,
      FACILITY_API_PUT_CONFIG
    );

    // Use batchTransactData to put the database
    const res = await batchTransactData(putItems);

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

function processItem(orcs, facilityType, facilityId, sk, item) {
  validateSortKey(facilityType, facilityId, sk)
  return createPostCommand(orcs, facilityType, facilityId, sk, item);
}

function createPostCommand(orcs, facilityType, facilityId, sk, item) {
  const pk = `facility::${orcs}`;
  sk = sk ? sk : `${facilityType}::${facilityId}`;

  item.pk = pk;
  item.sk = sk

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}
