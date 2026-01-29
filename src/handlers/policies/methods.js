/**
 * Functionality for policies
 */

const { REFERENCE_DATA_TABLE_NAME, batchTransactData, getOne, incrementCounter, runQuery } = require('/opt/dynamodb');
const { Exception } = require('/opt/base');
const { quickApiPutHandler, quickApiUpdateHandler } = require("../../common/data-utils");
const {
  POLICY_BOOKING_API_PUT_CONFIG,
  POLICY_BOOKING_API_UPDATE_CONFIG,
  POLICY_CHANGE_API_PUT_CONFIG,
  POLICY_CHANGE_API_UPDATE_CONFIG,
  POLICY_FEE_API_PUT_CONFIG,
  POLICY_FEE_API_UPDATE_CONFIG,
  POLICY_PARTY_API_PUT_CONFIG,
  POLICY_PARTY_API_UPDATE_CONFIG
} = require('./configs');

/**
 * Retrieves a policy and all of iW
 * @async
 * @function getPolicyById
 * @param {string} policyType - The type of the policy.
 * @param {string} policyId - The ID of the policy.
 * @returns {Promise<Object>} The policy data.
 * @throws {Exception} Throws an exception if there is an error retrieving the policy.
 */
async function getPolicyById(policyType, policyId, params = null) {

  const limit = params?.limit || null;
  const lastEvaluatedKey = params?.lastEvaluatedKey || null;
  const paginated = params?.paginated || true;

  // Validate required parameters
  if (!policyType) {
    throw new Exception('policyType is required', { code: 400 });
  }
  if (!policyId) {
    throw new Exception('policyId is required', { code: 400 });
  }

  try {
    const queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `policy::${policyType}::${policyId}` },
      },
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    return res;
  } catch (error) {
    throw new Exception('Error getting policy', { code: 400, error: error });
  }
}

async function getPolicyByIdVersion(policyType, policyId, policyIdVersion = 'latest') {
  try {
    if (policyIdVersion !== 'latest' && !isNaN(policyIdVersion)) {
      policyIdVersion = `v${String(policyIdVersion)}`;
    }
    const res = await getOne(`policy::${policyType}::${policyId}`, policyIdVersion, REFERENCE_DATA_TABLE_NAME);
    return res;
  } catch (error) {
    console.log('error:', error);
    throw new Exception('Error getting policy by version', { code: 400, error: error });
  }
}

// Change policy POST
async function handlePolicyPost(body, policyType) {
  let postRequests = [];
  if (!Array.isArray(body)) {
    body = [body];
  }
  for (let item of body) {
    postRequests = postRequests.concat(
      await processPostItem(item, policyType)
    );
  }

  // Set the correct config based on policy type
  let config = null;
  switch (policyType) {
    case 'booking':
      config = POLICY_BOOKING_API_PUT_CONFIG;
      break;
    case 'change':
      config = POLICY_CHANGE_API_PUT_CONFIG;
      break;
    case 'party':
      config = POLICY_PARTY_API_PUT_CONFIG;
      break;
    case 'fee':
      config = POLICY_FEE_API_PUT_CONFIG;
      break;
    default:
      throw new Exception(`Unsupported policy type: '${policyType}'`, { code: 400 });
  }

  // Execute the put operation
  const putItems = await quickApiPutHandler(
    REFERENCE_DATA_TABLE_NAME,
    postRequests,
    config
  );
  await batchTransactData(putItems);
  return postRequests[1]?.data;
}

async function handlePolicyPut(body, policyType, policyId) {
  let putRequests = [];
  if (!Array.isArray(body)) {
    body = [body];
  }
  for (let item of body) {
    putRequests = putRequests.concat(
      await processPutItem(item, policyType, policyId)
    );
  }

  // Set the correct config based on policy type
  let putConfig = null;
  let updateConfig = null;
  switch (policyType) {
    case 'booking':
      putConfig = POLICY_BOOKING_API_PUT_CONFIG;
      updateConfig = POLICY_BOOKING_API_UPDATE_CONFIG;
      break;
    case 'change':
      putConfig = POLICY_CHANGE_API_PUT_CONFIG;
      updateConfig = POLICY_CHANGE_API_UPDATE_CONFIG;
      break;
    case 'party':
      putConfig = POLICY_PARTY_API_PUT_CONFIG;
      updateConfig = POLICY_PARTY_API_UPDATE_CONFIG;
      break;
    case 'fee':
      putConfig = POLICY_FEE_API_PUT_CONFIG;
      updateConfig = POLICY_FEE_API_UPDATE_CONFIG;
      break;
    default:
      throw new Exception(`Unsupported policy type: '${policyType}'`, { code: 400 });
  }

  // Update the latest policy pointer
  // Items come back in pairs: [versionedPolicy, latestPolicy]

  const latestPolicies = await quickApiUpdateHandler(
    REFERENCE_DATA_TABLE_NAME,
    putRequests.filter(r => putRequests.indexOf(r) % 2 === 1), // Odd items are the latest pointers
    updateConfig
  );
  // Create the new versioned policy
  const versionedPolicies = await quickApiPutHandler(
    REFERENCE_DATA_TABLE_NAME,
    putRequests.filter(r => putRequests.indexOf(r) % 2 === 0), // Even items are the versioned policies
    putConfig
  );
  const transaction = [...latestPolicies, ...versionedPolicies];
  return await batchTransactData(transaction);
}

async function processPostItem(item, policyType) {
  let latestItem = null;
  if (item?.policyId) {
    throw new Exception(
      "Can't specify policyId in POST request; must be null to allow auto increment",
      { code: 400 }
    );
  }
  // Make sure defaults are set for the item
  item['policyType'] = policyType;

  // If it's a POST request, we need to increment the identifier
  // or we need to create the counter if it doesn't already exist. incrementCounter does either.
  // Pass in the pk to start iterating the collection.
  let policyId = await incrementCounter('policy', [policyType]);
  const pk = `policy::${policyType}::${policyId}`;
  let policyIdVersion = await incrementCounter(pk, ['version']);

  // Create the sk from the policyType and the identifier
  const sk = `v${String(policyIdVersion)}`;

  item['pk'] = pk;
  item['sk'] = sk;
  item['policyType'] = policyType;
  item['policyId'] = Number(policyId);
  item['identifier'] = Number(policyId);
  item['policyIdVersion'] = Number(policyIdVersion);

  // Create a second item pointing to the latest version
  latestItem = { ...item };
  latestItem.sk = 'latest';

  return [item, latestItem].map((i) => {
    return {
      key: {
        pk: i.pk,
        sk: i.sk
      },
      data: i,
    };
  });
}

async function processPutItem(item, policyType, policyId) {
  let returnedItems = [];

  if (!policyId) {
    throw new Exception(
      "policyId is required for PUT requests",
      { code: 400 }
    );
  }

  // Get the latest version of the policy to base the new version on
  const existingPolicy = await getPolicyByIdVersion(policyType, policyId, 'latest');
  if (!existingPolicy) {
    throw new Exception(
      `No existing policy found for policyType '${policyType}' and policyId '${policyId}'`,
      { code: 400 }
    );
  }

  // Get the fields that are allowed to be updated from the update config
  const updatableFields = Object.keys(POLICY_BOOKING_API_UPDATE_CONFIG.fields);
  console.log('updatableFields:', updatableFields);
  // Validate that only updatable fields are being modified
  console.log('item:', item);
  for (const key of Object.keys(item)) {
    if (!updatableFields.includes(key)) {
      throw new Exception(
        `Field '${key}' is not allowed to be updated for policyType '${policyType}' and policyId '${policyId}'`,
        { code: 400 }
      );
    }
  }

  // If we make it here, we can assume the update is valid. Now we need to create the new versioned item.

  const newVersion = existingPolicy?.policyIdVersion + 1;
  if (!newVersion || isNaN(newVersion) || newVersion < 1) {
    throw new Exception(
      `Error determining new version number for policyType '${policyType}' and policyId '${policyId}'`,
      { code: 400 }
    );
  }

  // Update item to have the latest policyIdVersion
  item.policyIdVersion = Number(newVersion);

  const newItem = { ...existingPolicy, ...item };

  newItem.sk = `v${String(newVersion)}`;


  // Add the versioned item
  returnedItems.push({
    key: {
      pk: newItem.pk,
      sk: newItem.sk
    },
    data: newItem,
  });

  // Add the latest item
  returnedItems.push({
    key: {
      pk: newItem.pk,
      sk: 'latest'
    },
    data: item,
  });

  return returnedItems;
}

module.exports = {
  handlePolicyPost,
  handlePolicyPut,
  getPolicyByIdVersion,
  getPolicyById,
};
