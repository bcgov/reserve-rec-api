const { Exception, logger, sendResponse } = require("/opt/base");
const { handlePolicyPost } = require("../methods");
const { POLICY_TYPE_ENUMS } = require("../../../common/data-constants");

/**
 * @api {post} /policies/{policyType}/ POST
 * Create Policy
 */
exports.handler = async (event, context) => {
  logger.info(`POST Policy: ${event}`);

  try {
    // Policies are immutable.
    // This endpoint is only for creating new policies.
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    const policyType = event?.pathParameters?.policyType || body?.policyType || null;

    if (!policyType || POLICY_TYPE_ENUMS.indexOf(policyType) === -1) {
      throw new Exception(`Invalid policy type: '${policyType}'. Policy type must be one of '${POLICY_TYPE_ENUMS.join(', ')}'.`, { code: 400 });
    }

    body['schema'] = 'policy';
    body['policyType'] = policyType;

    let res = null;
    switch(policyType) {
      case 'booking':
        logger.debug(`Processing booking policy POST request.`);
        res = await handlePolicyPost(body, 'booking');
        break;
      case 'change':
        logger.debug(`Processing change policy POST request.`);
        res = await handlePolicyPost(body, 'change');
        break;
      case 'party':
        logger.debug(`Processing party policy POST request.`);
        res = await handlePolicyPost(body, 'party');
        break;
      case 'fee':
        logger.debug(`Processing fee policy POST request.`);
        res = await handlePolicyPost(body, 'fee');
        break;
      default:
        throw new Exception(`POST for policy type '${policyType}' is not yet implemented.`, { code: 400 });
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