const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiUpdateHandler } = require("/opt/data-utils");
const { FACILITY_API_UPDATE_CONFIG } = require("/opt/facilities/configs");
const {
  validateRequiredFields,
  validateSortKey,
} = require("/opt/facilities/methods");
const { TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * @api {put} /facilities/{orcs} PUT
 * Update Facilities
 */
exports.handler = async (event, context) => {
  logger.info("PUT Facilities", event);
  try {
    const orcs = event?.pathParameters?.orcs;
    const body = JSON.parse(event?.body);

    if (!orcs) {
      throw new Exception("ORCS is required", { code: 400 });
    }

    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { facilityType, facilityId } = event?.queryStringParameters || {};
    let updateRequests = [];
    // Check if the request is a batch request
    if (Array.isArray(body)) {
      for (let item of body) {
        const { sk } = item;
        updateRequests.push(
          processItem(orcs, facilityType, facilityId, sk, item)
        );
      }
    } else {
      const { sk } = body;
      updateRequests.push(processItem(orcs, facilityType, facilityId, sk, body));
    }

    // Use quickApiPutHandler to create the put items
    const updateItems = await quickApiUpdateHandler(
      TABLE_NAME,
      updateRequests,
      FACILITY_API_UPDATE_CONFIG
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

function processItem(orcs, facilityType, facilityId, sk, item) {
  validateSortKey(facilityType, facilityId, sk);
  return createPutCommand(orcs, facilityType, facilityId, sk, item);
}

function createPutCommand(orcs, facilityType, facilityId, sk, item) {
  const pk = `facility::${orcs}`;
  sk = sk ? sk : `${facilityType}::${facilityId}`;

  // Remove pk, sk, facilityType, and facilityId as these can't be updated
  delete item.pk;
  delete item.sk;
  delete item.facilityType;
  delete item.facilityId;

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}
