const { RELATIONSHIP_API_PUT_CONFIG } = require('../configs');
const { Exception, logger, sendResponse } = require("/opt/base");
const { quickApiPutHandler } = require("../../../common/data-utils");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData } = require("/opt/dynamodb");

/**
 * POST /relationships
 * 
 * Creates a new relationship between two entities.
 * Request body must include: pk1, sk1, pk2, sk2
 *
 */

exports.handler = async (event, context) => {
  logger.info("POST relationship", event);
  try {
    
    const { pk1, sk1, pk2, sk2 } = JSON.parse(event?.body);

    // Validate required parameters
    const missingParams = [];
    if (!event.body) missingParams.push("body");
    if (!pk1) missingParams.push("pk1");
    if (!sk1) missingParams.push("sk1");
    if (!pk2) missingParams.push("pk2");
    if (!sk2) missingParams.push("sk2");

    if (missingParams.length > 0) {
      throw new Exception(
        `Cannot create relationship - missing required parameter(s): ${missingParams.join(", ")}`,
        { code: 400 }
      );
    }

    // Extract schemas from pks for validation and storage
    const schema1 = pk1.split('::')[0];
    const schema2 = pk2.split('::')[0];

    // Construct the relationship item using full pks
    const relationshipItem = {
      pk: `rel::${pk1}::${sk1}`,
      sk: `${pk2}::${sk2}`,
      gsipk: `rel::${pk2}::${sk2}`,
      gsisk: `${pk1}::${sk1}`,
      schema: 'relationship',
      schema1,
      schema2,
      pk1,
      sk1,
      pk2,
      sk2
    };

    logger.info('Creating relationship:', relationshipItem);

    // Create the relationship item
    const item = {
      key: {
        pk: relationshipItem.pk,
        sk: relationshipItem.sk
      },
      data: relationshipItem
    };

    const putItems = await quickApiPutHandler(
      REFERENCE_DATA_TABLE_NAME,
      [item],
      RELATIONSHIP_API_PUT_CONFIG,
    );

    const res = await batchTransactData(putItems);

    return sendResponse(200, res, "Success", null, context);
  } catch (error) {
    logger.error('Error creating relationship:', error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error creating relationship",
      null,
      context
    );
  }
};
