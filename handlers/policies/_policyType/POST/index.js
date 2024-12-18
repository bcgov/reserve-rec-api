/**
 * Create a policy
 */

const { Exception, logger, sendResponse } = require('/opt/base');
const { getNextIdentifier, quickApiPutHandler } = require('/opt/data-utils');
const { TABLE_NAME, batchTransactData } = require('/opt/dynamodb');
const { POLICY_API_CREATE_CONFIGS, POLICY_TYPES } = require('/opt/policies/configs');


exports.handler = async (event, context) => {
  logger.info('Create Policy', event);
  try {

    let body = JSON.parse(event.body);

    const policyType = event?.pathParameters?.policyType || null;
    if (!policyType || !POLICY_TYPES.includes(policyType)) {
      throw new Exception(`Invalid policy type: ${policyType}`, { code: 400 });
    }

    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    let item = { ...body };

    // Generate pk and sk
    item.pk = `policy::${policyType}`;
    // get next available value
    let nextId = await getNextIdentifier(TABLE_NAME, item.pk, 'sk');
    item.sk = String(nextId);
    item.policyId = nextId;
    item.policyType = policyType;
    item.category = 'policy';

    // Set the policy config
    config = POLICY_API_CREATE_CONFIGS[policyType];

    let createCommand = {
      data: item
    }

    logger.debug('createCommand', createCommand);

    let commandList = await quickApiPutHandler(TABLE_NAME, [createCommand], config);
    await batchTransactData(commandList);

    const returnData = {
      item: item
    }

    return sendResponse(200, returnData, `New ${policyType} policy created.`, null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};