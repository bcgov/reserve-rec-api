const { Exception, sendResponse, logger } = require('/opt/base');
const { getPoliciesByType, getPolicyById } = require('/opt/policies/methods');
const { POLICY_TYPES } = require('/opt/policies/configs');

exports.handler = async (event, context) => {
  logger.info('Get Policies', event);

  try {

    const policyType = event?.pathParameters?.policyType;

    if (!POLICY_TYPES.includes(policyType)) {
      throw new Exception(`Invalid policy type: ${policyType}`, {
        code: 400,
        error: 'Invalid PolicyType',
      });
    }

    const policyId = event?.pathParameters?.policyId || event?.queryStringParameters?.policyId || null;

    let policies = {};

    if (policyId) {
      // keep return format the same as getPoliciesByType
      let res = await getPolicyById(policyType, policyId);
      policies['items'] = [res];
    } else {
      policies = await getPoliciesByType(policyType);
    }

    return sendResponse(200, policies, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};