const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { ACTIVITY_API_PUT_CONFIG, ACTIVITY_RELATIONSHIP_FIELDS } = require("../../configs");
const { guardRelationshipFields, parseRequest } = require("../../methods");
const { auditRelationshipChanges, createEntityWithRelationships } = require("../../../../common/relationship-utils");

/**
 * @api {post} /activities/{collectionId} POST
 * Create Activities
 */
exports.handler = async (event, context) => {
  logger.info(`POST Activities: ${event}`);
  
  try {
    const authContext = checkAuthContext(event, 'staff');

    const collectionId = event?.pathParameters?.collectionId;
    if (!collectionId) {
      throw new Exception("collectionId is required", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Body is required", { code: 400 });
    }

    await guardRelationshipFields(event, collectionId, body);

    body['collectionId'] = collectionId;
    body['schema'] = "activity";

    // Grab the activityType if provided
    const { activityType } = event?.queryStringParameters || {};

    // Retries with a fresh counter id when the write fails
    const { postRequests, added, removed } = await createEntityWithRelationships({
      schema: 'activity',
      collectionId,
      body,
      parseArgs: [activityType],
      relationshipFields: ACTIVITY_RELATIONSHIP_FIELDS,
      putConfig: ACTIVITY_API_PUT_CONFIG,
      parseRequest,
    });

    await auditRelationshipChanges(authContext.sub, { added, removed });

    return sendResponse(200, postRequests, "Success", null, context);
  } catch (error) {
    logger.error("Error in POST Activities:", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
