const { Exception, logger, sendResponse } = require("/opt/base");
const { getPolicyById, getPolicyByIdVersion, getAllPoliciesByProduct } = require("../methods");
const { getByGSI, REFERENCE_DATA_TABLE_NAME } = require("/opt/dynamodb");

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
    const productFlag = event?.queryStringParameters?.product || null;

    // Allow user to pass in product pk and sk to fetch all policies related to the product
    if (productFlag) {
      logger.info("Product flag is set to true, fetching product policies");
      const productPk = event?.queryStringParameters?.productPk || null;
      const productSk = event?.queryStringParameters?.productSk || null;

      if (!productPk || !productSk) {
        throw new Exception("Product PK and SK are required when product flag is set", { code: 400 });
      }

      const res = await getAllPoliciesByProduct(productPk, productSk);
      return sendResponse(200, res, "Success", null, context);
    }

    
    if (!policyType) {
      throw new Exception("Policy Type (policyType) is required", { code: 400 });
    }

    // If we don't have a policyId or policyIdVersion
    if (!policyId && !policyIdVersion) {
      const res = await getByGSI('gsipk', `policy::${policyType}`, REFERENCE_DATA_TABLE_NAME, 'entityRelationship-index');
      return sendResponse(200, res, "Success", null, context);
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
