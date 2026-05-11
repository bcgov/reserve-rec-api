const { logger, sendResponse, Exception } = require("/opt/base");
const { REFERENCE_DATA_TABLE_NAME, batchTransactData, getOne, marshall } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info("PUT Product Date", event);

  // Allow Options
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    const collectionId = event?.pathParameters?.collectionId;
    const activityType = event?.pathParameters?.activityType;
    const activityId = event?.pathParameters?.activityId;
    const productId = event?.pathParameters?.productId;
    const date = event?.pathParameters?.date;

    if (!collectionId || !activityType || !activityId || !productId || !date) {
      throw new Exception("Missing required path parameters", { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception("Request body is required", { code: 400 });
    }

    const pk = `productDate::${collectionId}::${activityType}::${activityId}::${productId}`;
    const sk = date;

    // Fetch the existing ProductDate
    const existingProductDate = await getOne(pk, sk);
    
    if (!existingProductDate) {
      throw new Exception(`ProductDate not found for ${pk}::${sk}`, { code: 404 });
    }

    // Merge the updates with existing data
    const updatedProductDate = {
      ...existingProductDate,
      assetList: body.assetList || existingProductDate.assetList,
      // Update reservation context if provided
      ...(body.reservationContext && { reservationContext: { ...existingProductDate.reservationContext, ...body.reservationContext } }),
      lastUpdated: new Date().toISOString()
    };

    logger.debug("Updated ProductDate:", JSON.stringify(updatedProductDate));

    // Build a PUT request using marshall to handle conversion
    const putRequest = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      Item: marshall(updatedProductDate, { removeUndefinedValues: true })
    };

    logger.debug("PUT request:", JSON.stringify(putRequest));

    // Use batchTransactData with Put operation
    const result = await batchTransactData([{
      ...putRequest,
      ConditionExpression: "attribute_exists(pk)" // Ensure item exists
    }], 'Put');

    logger.info(`Successfully updated ProductDate for ${productId} on ${date}`);

    return sendResponse(200, updatedProductDate, `Successfully updated ProductDate for ${productId} on ${date}`, null, context);

  } catch (error) {
    logger.error("Error in PUT Product Date", error);
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || error.message || "Error",
      error?.error || error,
      context
    );
  }
};
