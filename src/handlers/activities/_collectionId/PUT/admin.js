const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { ACTIVITY_API_UPDATE_CONFIG, ACTIVITY_RELATIONSHIP_FIELDS } = require("../../configs");
const { guardRelationshipFields, parseRequest } = require("../../methods");
const { auditRelationshipChanges, createEntityWithRelationships } = require("../../../../common/relationship-utils");

/**
 * @api {put} /activities/{collectionId} PUT
 * Update Activities
 */
exports.handler = async (event, context) => {
  logger.info(`PUT Activities: ${event}`);

  try {
    const authContext = checkAuthContext(event, 'staff');

    const collectionId = event?.pathParameters?.collectionId;    
    const activityType = event?.pathParameters?.activityType || event?.queryStringParameters?.activityType || null;
    const activityId = event?.pathParameters?.activityId || event?.queryStringParameters?.activityId || null;

    if (!collectionId && !activityType && !activityId) {
      throw new Exception("Activity Collection ID, Activity Type, and Activity ID are required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    await guardRelationshipFields(event, collectionId, body);

    // Only relationship fields present in the body are synced; absent ones keep their links
    const { postRequests, added, removed } = await createEntityWithRelationships({
      schema: 'activity',
      collectionId,
      body,
      requestMethod: 'PUT',
      parseArgs: [activityType, activityId],
      relationshipFields: ACTIVITY_RELATIONSHIP_FIELDS,
      putConfig: ACTIVITY_API_UPDATE_CONFIG,
      parseRequest,
    });

    await auditRelationshipChanges(authContext.sub, { added, removed });

    return sendResponse(200, postRequests, "Success", null, context);
  } catch (error) {
    logger.error(`Error in PUT Activities: ${error}`);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};

