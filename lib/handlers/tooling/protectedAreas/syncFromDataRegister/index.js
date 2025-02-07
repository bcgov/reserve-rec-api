/**
 * Syncs protected area data from the Data Register to the Reserve Rec Database.
 * If a protected area is not already in the Reserve Rec Database, it will be added.
 */

const { getNowISO, httpGet, logger, sendResponse } = require('/opt/base');
const { TABLE_NAME, batchTransactData, getOne, marshall } = require('/opt/dynamodb');
const { getSecretValue } = require('/opt/secretsManager');

const DATA_REGISTER_URL = process.env.DATA_REGISTER_URL || 'https://dev-data.bcparks.ca/api';
const DATA_REGISTER_SUBDIRECTORY = '/parks/names';
const ESTABLISHED_STATE = 'established';

// Add data register fields to sync here (orcs will automatically be synced)
const FIELDS_TO_SYNC = [
  'displayName'
];

exports.handler = async (event, context) => {
  logger.info('Sync Protected Areas from Data Register');

  // If true, all protected areas will be updated regardless of whether they have changed (helps to trigger a dynamo stream event)
  const forceUpdate = event?.forceUpdate || false;
  const fieldsToSync = event?.fieldsToSync || FIELDS_TO_SYNC;

  try {
    // Get list of park names from the Data Register
    const params = {
      status: ESTABLISHED_STATE
    };
    const headers = {
      'x-api-key': await getSecretValue('DATA_REGISTER_API_KEY')
    };
    const url = `${DATA_REGISTER_URL}${DATA_REGISTER_SUBDIRECTORY}`;
    const list = await httpGet(url, params, headers);

    // get the protected areas from the response
    const protectedAreas = list?.data?.data?.items || [];

    logger.debug(`Protected Areas: ${protectedAreas.length} found.`);

    // Add each protected area to the database
    if (!protectedAreas || protectedAreas.length === 0) {
      throw new Error('No protected areas found');
    }
    const { created, updated } = await syncData(protectedAreas, fieldsToSync, forceUpdate);
    return sendResponse(200, { created: created, updated: updated }, 'Success', null, context);
  } catch (error) {
    return sendResponse(400, error.message);
  }
};

async function syncData(protectedAreas, fieldsToSync, forceUpdate = false) {
  let updateList = [];
  let now = getNowISO();
  let created = 0;
  let updated = 0;
  for (const protectedArea of protectedAreas) {

    // Don't include Sites for now.
    // TODO: Update this check when Sites are added to the database
    if (protectedArea?.pk.includes('Site::')) {
      continue;
    }
    // DynamoDB RRUs are 20% the cost of WRUs, so we can afford to check if the item exists before
    // adding it, instead of doing a PUT with a conditional expression.
    // Usually this should be cheaper since we expect most items to already exist.
    const existingItem = await getOne('protectedArea', `${protectedArea.pk}`);

    // If the item does not exist, add it to the database
    if (!existingItem) {
      updateList.push(await createPutPAItem(protectedArea, fieldsToSync, now));
      created++;
      continue;
    }

    // If the item exists but one of the syncing fields has changed, update the item in the database
    const shouldUpdate = fieldsToSync.some(field => {
      return protectedArea?.[field] !== existingItem?.[field];
    });

    if (shouldUpdate || forceUpdate) {
      updateList.push(await createUpdatePAItem(protectedArea, fieldsToSync, now));
      updated++;
    }
  }
  logger.info(`Updating ${updateList.length} protected areas.`);
  await batchTransactData(updateList);
  return {
    created: created,
    updated: updated
  };
}

async function createPutPAItem(protectedArea, fieldsToSync, timestamp) {
  let item = {
    pk: 'protectedArea',
    sk: `${protectedArea.pk}`,
    orcs: protectedArea.pk,
    identifier: protectedArea.pk,
    schema: 'protectedArea',
    timeZone: 'America/Vancouver',
    minMapZoom: 10,
    maxMapZoom: 18,
    imageUrl: 'https://picsum.photos/500',
    version: 1,
    creationDate: timestamp,
    lastUpdated: timestamp
  };
  for (const field of fieldsToSync) {
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

function createUpdatePAItem(protectedArea, fieldsToSync, timestamp) {
  let expressionAttributeNames = {};
  let expressionAttributeValues = {
    ':lastUpdated': { S: timestamp }
  };
  let updateClauses = [`lastUpdated = :lastUpdated`];
  for (const field of fieldsToSync) {
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
        sk: { S: `${protectedArea.pk}::properties` }
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }
  };
  return updateItem;
}