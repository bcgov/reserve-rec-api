// Create new transaction
const { Exception, logger, sendResponse } = require("/opt/base");
const { createTransaction } = require("/opt/transactions/methods");
const { batchTransactData, TABLE_NAME } = require("/opt/dynamodb");
const { quickApiPutHandler } = require("/opt/data-utils");
const { TRANSACTION_PUT_CONFIG } = require("/opt/transactions/configs");

exports.handler = async (event, context) => {
  logger.info("Transactions POST:", event);

  try {
    // Get relevant data from the event
    const body = JSON.parse(event?.body);
    logger.debug("transaction body: ", body);

    if (!body?.trnAmount || !body?.bookingId || !body.sessionId) {
      throw new Exception("Missing required transaction fields", { code: 400 });
    }

    const postRequests = await createTransaction(body);

    const putItems = await quickApiPutHandler(
      TABLE_NAME,
      [postRequests],
      TRANSACTION_PUT_CONFIG
    );

    const res = await batchTransactData(putItems);

    const response = {
      res: res,
      transaction: postRequests,
    };

    logger.info(`Transaction created successfully`, response);

    return sendResponse(200, { response }, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
