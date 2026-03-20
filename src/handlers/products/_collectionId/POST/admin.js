const { logger, sendResponse } = require("/opt/base");
const { PRODUCT_API_PUT_CONFIG } = require("../../configs");
const { parseRequest } = require("../../methods");
const { createEntityWithRelationships } = require("../../../../common/relationship-utils.js");


/**
 * @api {post} /products/{collectionId} POST
 * Create Products
 */
exports.handler = async (event, context) => {
  logger.info("POST Products", event);
  try {
    const body = JSON.parse(event?.body);
    const collectionId = String(event?.pathParameters?.collectionId);
    const activityType = event?.queryStringParameters?.activityType || event.pathParameters?.activityType || body?.activityType;
    const activityId = event?.queryStringParameters?.activityId || event.pathParameters?.activityId || body?.activityId;

    // Validate required parameters from body
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!collectionId) missingParams.push("collectionId");
    if (!activityType) missingParams.push("activityType");
    if (!activityId) missingParams.push("activityId");

    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    // If body is an array, validate each item has required fields
    if (body.length > 0) {
      for (const item of body) {
        if (!item.activityType || !item.activityId) {
          throw new Error("Each item in body must include activityType and activityId");
        }
      }
    }

    // Add collection and schema
    body['collectionId'] = collectionId;
    body['schema'] = "product";

    // Automatically construct the activities relationship from activityId and activityType
    if (body.activityId && body.activityType && collectionId) {
      body['activities'] = [{
        pk: `activity::${collectionId}`,
        sk: `${body.activityType}::${body.activityId}`
      }];
      logger.info(`Constructed activity relationship: ${body['activities'][0].pk}::${body['activities'][0].sk}`);
    }

    // Create product with relationships using consolidated workflow
    let postRequests = await createEntityWithRelationships({
      schema: 'product',
      collectionId,
      body,
      parseArgs: [body.activityType, body.activityId],
      relationshipFields: ['activities'],
      putConfig: PRODUCT_API_PUT_CONFIG,
      parseRequest
    });

    return sendResponse(200, postRequests, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.mgs || error.message || "Error",
      error?.error || error,
      context
    );
  }
};
