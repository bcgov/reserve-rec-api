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
    const collectionId = String(event?.pathParameters?.collectionId);
    const body = JSON.parse(event?.body);

    // Validate required parameters from body
    const missingParams = [];
    if (!body) missingParams.push("body");
    if (!collectionId) missingParams.push("collectionId");

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

    // Create product with relationships using consolidated workflow
    const result = await createEntityWithRelationships({
      schema: 'product',
      collectionId,
      body,
      relationshipFields: ['activities'],
      putConfig: PRODUCT_API_PUT_CONFIG,
      parseRequest
    });

    logger.info(`Created product with ${result.relationshipCount} relationships`);

    return sendResponse(200, result.postRequests, "Success", null, context);
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
