const {
  getActivitiesByCollectionId,
  getActivitiesByActivityType,
  getActivityByActivityId,
} = require('../../methods');
const { Exception, logger, sendResponse } = require('/opt/base');
const { ALLOWED_FILTERS } = require('../../configs');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const WAITING_ROOM_TABLE_NAME = process.env.WAITING_ROOM_TABLE_NAME;
let _client;
function getClient() {
  if (!_client) _client = new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' });
  return _client;
}

/**
 * Checks if a waiting room queue is active for the given facility + date.
 * Returns { waitingRoomActive, waitingRoomOpeningTime } to append to the activity response.
 */
async function getWaitingRoomStatus(collectionId, activityType, activityId, startDate) {
  if (!WAITING_ROOM_TABLE_NAME || !startDate) return {};
  try {
    const pk = `QUEUE#${collectionId}#${activityType}#${activityId}#${startDate}`;
    const result = await getClient().send(new GetItemCommand({
      TableName: WAITING_ROOM_TABLE_NAME,
      Key: marshall({ pk, sk: 'META' }),
    }));
    if (!result.Item) return { waitingRoomActive: false };
    const meta = unmarshall(result.Item);
    const active = meta.queueStatus !== 'closed';
    return {
      waitingRoomActive: active,
      waitingRoomOpeningTime: active ? meta.openingTime : undefined,
    };
  } catch (e) {
    logger.warn(`Failed to check waiting room status: ${e.message}`);
    return {};
  }
}

/**
 * @api {get} /activities/{collectionId} GET (public)
 * Fetch Activities — same as admin handler but appends waitingRoomActive
 * when activityId + startDate are both provided.
 */
exports.handler = async (event, context) => {
  logger.info(`GET Activities (public): ${event}`);

  if (event?.httpMethod === 'OPTIONS') {
    return sendResponse(200, null, 'Success', null, context);
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    if (!collectionId) {
      throw new Exception('Activity Collection ID (collectionId) is required', { code: 400 });
    }

    const { activityType, activityId, startDate, ...queryParams } =
      event?.queryStringParameters || {};

    let res = null;
    let filters = {};
    ALLOWED_FILTERS.forEach((filter) => {
      if (queryParams[filter.name]) {
        filters[filter.name] =
          queryParams[filter.name] === 'true'
            ? true
            : queryParams[filter.name] === 'false'
              ? false
              : queryParams[filter.name];
      }
    });

    if (activityType && activityId) {
      res = await getActivityByActivityId(collectionId, activityType, activityId, queryParams?.fetchFacilities || null, queryParams?.fetchGeozone || null);
      // Append waiting room status when startDate is provided
      const wrStatus = await getWaitingRoomStatus(collectionId, activityType, activityId, startDate);
      res = { ...res, ...wrStatus };
    }

    if (activityType && !activityId) {
      res = await getActivitiesByActivityType(collectionId, activityType, filters, event?.queryStringParameters || null);
    }

    if (!activityType && !activityId) {
      res = await getActivitiesByCollectionId(collectionId, filters, event?.queryStringParameters || null);
    }

    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || 'Error',
      error?.error || error,
      context
    );
  }
};
