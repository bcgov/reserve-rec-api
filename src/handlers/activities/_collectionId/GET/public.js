const {
  getActivitiesByCollectionId,
  getActivitiesByActivityType,
  getActivityByActivityId,
} = require('../../methods');
const { Exception, logger, sendResponse, filterByRole } = require('/opt/base');
const { ALLOWED_FILTERS } = require('../../configs');
const { ROLE_BASED_FILTERS } = require('../../../facilities/configs');
const { getQueueMeta, getActiveMode2Meta } = require('../../../waiting-room/utils/dynamodb');

/**
 * Checks if a waiting room queue is active for the given facility + date.
 * Returns { waitingRoomActive, waitingRoomOpeningTime } to append to the activity response.
 */
async function getWaitingRoomStatus(collectionId, activityType, activityId, startDate) {
  if (!process.env.WAITING_ROOM_TABLE_NAME || !startDate) return {};
  try {
    const meta = await getQueueMeta(`QUEUE#${collectionId}#${activityType}#${activityId}#${startDate}`);
    if (!meta) {
      // Facility-specific queue not found — check Mode 2 global queue
      return { waitingRoomActive: !!(await getActiveMode2Meta()) };
    }
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
      const fetchFacilities = queryParams?.fetchFacilities === 'true';
      res = await getActivityByActivityId(collectionId, activityType, activityId, fetchFacilities, queryParams?.fetchGeozone || null);
      if (fetchFacilities && res?.facilities) {
        const visible = res.facilities.filter((facility) => facility.isVisible !== false);
        res.facilities = filterByRole(visible, 'default', ROLE_BASED_FILTERS);
      }
      // Append waiting room status when startDate is provided
      const wrStatus = await getWaitingRoomStatus(collectionId, activityType, activityId, startDate);
      res = { ...res, ...wrStatus };
    }

    if (activityType && !activityId) {
      // Public handler: only visible (non-draft) activities.
      res = await getActivitiesByActivityType(collectionId, activityType, filters, event?.queryStringParameters || null, true);
    }

    if (!activityType && !activityId) {
      // Public handler: only visible (non-draft) activities.
      res = await getActivitiesByCollectionId(collectionId, filters, event?.queryStringParameters || null, true);
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
