const { Exception, logger, sendResponse } = require("/opt/base");
const { handlePolicyPut } = require("../methods");
const { POLICY_TYPE_ENUMS } = require("../../../common/data-constants");

/**
 * @api {put} /policies/{policyType}/{policyId} PUT
 * Update Policy
 */
exports.handler = async (event, context) => {
  logger.info(`PUT Policy: ${event}`);

  try {
    // Policies are immutable.
    // This endpoint will version an existing policy. All versions are retained.
    const body = JSON.parse(event?.body);
    const policyType = event?.pathParameters?.policyType || body?.policyType || null;
    const policyId = event?.pathParameters?.policyId || body?.policyId || null;
    if (!body || !policyId || !policyType) {
      throw new Exception("Body, policy type and policy ID are required", { code: 400 });
    }

    if (POLICY_TYPE_ENUMS.indexOf(policyType) === -1) {
      throw new Exception(`Invalid policy type: '${policyType}'. Policy type must be one of '${POLICY_TYPE_ENUMS.join(', ')}'.`, { code: 400 });
    }

    let res = null;
    switch(policyType) {
      case 'booking':
        logger.debug(`Processing booking policy PUT request.`);
        res = await handlePolicyPut(body, 'booking', policyId);
        break;
      case 'change':
        logger.debug(`Processing change policy PUT request.`);
        res = await handlePolicyPut(body, 'change', policyId);
        break;
      case 'party':
        logger.debug(`Processing party policy PUT request.`);
        res = await handlePolicyPut(body, 'party', policyId);
        break;
      case 'fee':
        logger.debug(`Processing fee policy PUT request.`);
        res = await handlePolicyPut(body, 'fee', policyId);
        break;
      default:
        throw new Exception(`PUT for policy type '${policyType}' is not yet implemented.`, { code: 400 });
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
}