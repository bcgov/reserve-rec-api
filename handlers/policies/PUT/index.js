/**
 * Update a policy
 */

const { Exception, logger, sendResponse } = require('/opt/base');
const { quickApiUpdateHandler } = require('/opt/data-utils');
const { TABLE_NAME, batchTransactData } = require('/opt/dynamodb');
const { POLICY_API_UPDATE_CONFIGS } = require('/opt/policies/configs');

exports.handler = async (event, context) => {
  logger.info('Update Policy', event);
  try {

    // get policyType
    let policyType = event?.pathParameters?.policyType || null;

    // get policyId
    let policyId = event?.pathParameters?.policyId || null;

    // get body
    let body = JSON.parse(event?.body);

    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    if (!Array.isArray(body)) {
      body = [body];
    }

    let commands = [];

    // Check for required fields
    for (const item of body) {

      // you cannot change the policy type or id.
      localPolicyType = item?.policyType || policyType;
      delete item.policyType;

      localPolicyId = item?.policyId || policyId;
      delete item.policyId;

      key = {
        pk: `policy::${localPolicyType}`,
        sk: String(localPolicyId)
      };

      commands.push({
        key: key,
        data: item,
        config: POLICY_API_UPDATE_CONFIGS[localPolicyType]
      });
    }

    logger.debug('commands', commands);

    let commandList = await quickApiUpdateHandler(TABLE_NAME, commands);

    await batchTransactData(commandList);

    return sendResponse(200, `Updated ${commandList.length} items.`, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  };
}

