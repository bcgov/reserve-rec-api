/**
 * Syncs protected area data from the Data Register to the Reserve Rec Database.
 * If a protected area is not already in the Reserve Rec Database, it will be added.
 */

const { getNowISO, httpGet, logger, sendResponse } = require('/opt/base');
const { TABLE_NAME, batchTransactData, getOne, marshall } = require('/opt/dynamodb');

const DATA_REGISTER_ENDPOINT = process.env.DATA_REGISTER_ENDPOINT || 'https://dev-data.bcparks.ca/api';
const DATA_REGISTER_SUBDIRECTORY = '/parks/names';
const DATA_REGISTER_API_KEY = process.env.DATA_REGISTER_API_KEY;
const ESTABLISHED_STATE = 'established';

// Add data register fields to sync here
const FIELDS_TO_SYNC = [
  'legalName',
  'displayName'
];

exports.handler = async (event, context) => {
  try {
    // Get list of park names from the Data Register
    const params = {
      status: ESTABLISHED_STATE
    };
    const headers = {
      'x-api-key': DATA_REGISTER_API_KEY
    }
    const url = `${DATA_REGISTER_ENDPOINT}${DATA_REGISTER_SUBDIRECTORY}`;
    const list = await httpGet(url, params, headers);

    // get the protected areas from the response
    const protectedAreas = list?.data?.data?.items || [];

    // Add each protected area to the database
    if (!protectedAreas || protectedAreas.length === 0) {
      throw new Error('No protected areas found');
    }
    await syncData(protectedAreas);
    return sendResponse(200, [], 'Success', null, context);
  } catch (error) {
    return sendResponse(400, error.message);
  }
};

async function syncData(protectedAreas) {
  let updateList = [];
  let now = getNowISO();
  for (const protectedArea of protectedAreas) {
    // Don't include Sites for now.
    // TODO: Update this check when Sites are added to the database
    if (protectedArea?.pk.includes('Site::')) {
      continue;
    }
    // DynamoDB RRUs are 20% the cost of WRUs, so we can afford to check if the item exists before
    // adding it, instead of doing a PUT with a conditional expression.
    // Usually this should be cheaper since we expect most items to already exist.
    const existingItem = await getOne('protectedArea', protectedArea.pk);

    // If the item does not exist, add it to the database
    if (!existingItem) {
      updateList.push(await createPutPAItem(protectedArea, now));
      continue;
    }

    // If the item exists but one of the syncing fields has changed, update the item in the database
    const shouldUpdate = FIELDS_TO_SYNC.some(field => {
      return protectedArea?.[field] !== existingItem?.[field];
    });

    if (shouldUpdate) {
      updateList.push(await createUpdatePAItem(protectedArea, now));
    }
  }
  logger.info(`Updating ${updateList.length} protected areas.`);
  await batchTransactData(updateList);
}

async function createPutPAItem(protectedArea, timestamp) {
  let item = {
    pk: 'protectedArea',
    sk: protectedArea.pk,
    orcs: protectedArea.pk,
    creationDate: timestamp,
    lastUpdated: timestamp
  };
  for (const field of FIELDS_TO_SYNC) {
    item[field] = protectedArea[field];
  }
  const putItem = {
    action: 'Put',
    data: {
      TableName: TABLE_NAME,
      Item: marshall(item),
      ConditionExpression: 'attribute_not_exists(pk)'
    }
  };
  return putItem;
}

function createUpdatePAItem(protectedArea, timestamp) {
  let expressionAttributeNames = {};
  let expressionAttributeValues = {
    ':lastUpdated': { S: timestamp }
  };
  let updateClauses = [`lastUpdated = :lastUpdated`];
  for (const field of FIELDS_TO_SYNC) {
    updateClauses.push(`#${field} = :${field}`);
    expressionAttributeNames[`#${field}`] = field;
    expressionAttributeValues[`:${field}`] = marshall(protectedArea[field]);
  }
  let updateExpression = `SET ${updateClauses.join(', ')}`;
  const updateItem = {
    action: 'Update',
    data: {
      TableName: TABLE_NAME,
      Key: {
        pk: { S: 'protectedArea' },
        sk: { S: protectedArea.pk }
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }
  };
  return updateItem;
}
