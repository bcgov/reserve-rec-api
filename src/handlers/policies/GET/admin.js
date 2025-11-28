const { Exception, logger, sendResponse } = require("/opt/base");
const { getPolicyById, getPolicyByIdVersion } = require("../methods");

/**
 * @api {get} /policies/{policyType}/{policyId} GET
 * Fetch Policies
 */
exports.handler = async (event, context) => {
  logger.info(`GET Policies:`, JSON.stringify(event, null, 2));

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const policyType = event?.pathParameters?.policyType || event?.queryStringParameters?.policyType || null;
    const policyId = event?.pathParameters?.policyId || event?.queryStringParameters?.policyId || null;
    const policyIdVersion = event?.pathParameters?.policyIdVersion || event?.queryStringParameters?.policyIdVersion || null;

    if (!policyType) {
      throw new Exception("Policy Type (policyType) is required", { code: 400 });
    }

    // Grab the facilityType or facilityId if provided
    const { ...queryParams } =
      event?.queryStringParameters || {};
    let res = null;

    if (policyId) {
      if (policyIdVersion) {
        res = await getPolicyByIdVersion(policyType, policyId, policyIdVersion);
        // Fetch specific policy ID version
      } else {
        res = await getPolicyById(policyType, policyId, queryParams);
        // Fetch latest policy by ID
      }
    } else {
      // Fetch policies by type (Not sure we want to allow this as there could be many. For now, we will throw an error)
      throw new Exception("Policy ID (policyId) is required when fetching policies by type", { code: 400 });
    }

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
