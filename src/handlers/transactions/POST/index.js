// Create new transaction
const { Exception, logger, sendResponse, getRequestClaimsFromEvent } = require("/opt/base");
const { createTransaction } = require("../methods");
const { batchTransactData, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { quickApiPutHandler } = require("../../../common/data-utils");
const { TRANSACTION_PUT_CONFIG } = require("../configs");

exports.handler = async (event, context) => {
  logger.info("Transactions POST:", event);

  try {
    // Get relevant data from the event
    const body = JSON.parse(event?.body);
    logger.debug("transaction body: ", body);

    // Get the user sub from the authorizer context
    let userId = getRequestClaimsFromEvent(event)?.sub || null;
    
    if (!userId) {
      throw new Exception("Cannot create transaction - missing userId", { code: 401 });
    }

    if (!body?.trnAmount || !body?.bookingId || !body.sessionId) {
      throw new Exception("Missing required transaction fields", { code: 400 });
    }

    const postRequests = await createTransaction(body, userId);

    const putItems = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
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
