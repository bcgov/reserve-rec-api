const { Exception, getNow, logger } = require("/opt/base");
const { createHash } = require("crypto");
const { DateTime } = require("luxon");
const axios = require("axios");
const { getOneByGlobalId } = require("/opt/dynamodb");

const HASH_KEY = process.env.HASH_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;

function createHashExpiry() {
  const date = DateTime.now().plus({ minutes: 30 });
  return date.toFormat("yyyyLLddHHmm");
}

// Creates a transaction ID from the Booking ID, prefixes with "BCPR-" but
// needs to be less that 30 characters for Worldline to accept
function generateClientTransactionId(bookingId) {
  const prefix = "BCPR-";
  const sliceLength = 30 - prefix.length;
  const uuidSlice = bookingId.slice(0, sliceLength);
  return `${prefix}${uuidSlice}`;
}

// Creates the Worldline URL for a single-payment, and inserts the transaction
// details into dynamo
async function createTransaction(body) {
  try {
    // Use booking ID to create our transaction ID
    const clientTransactionId = generateClientTransactionId(body.bookingId);

    // Constructing the URL string params for Worldline
    const url = `https://web.na.bambora.com/scripts/Payment/Payment.asp`;
    const query = new URLSearchParams({
      merchant_id: MERCHANT_ID,
      trnType: "P",
      trnOrderNumber: clientTransactionId,
      trnAmount: `${body.trnAmount}`,
      ref1: `${body.bookingId}`,
      ref2: `${body.sessionId}`,
      hashExpiry: createHashExpiry(),
    });

    // Create Worldline single-payment URL with hash
    const transactionUrl = createUrlWithHash(query, url);
    logger.info("transactionUrl: ", transactionUrl);

    // Set part of the pk as today
    const today = getNow().toFormat("yyyy-LL-dd");

    // Items that will be inserted into dynamo for initial transaction
    let transactionObj = {
      pk: `transaction::${today}`,
      sk: `${clientTransactionId}`,
      amount: body.trnAmount,
      bookingId: body.bookingId,
      globalId: clientTransactionId,
      sessionId: body.sessionId,
      schema: "transaction",
      status: "in progress",
      clientTransactionId: clientTransactionId,
      transactionUrl: transactionUrl,
    };
    logger.info("transactionObj: ", transactionObj);

    return {
      key: { pk: transactionObj.pk, sk: transactionObj.sk },
      data: transactionObj,
    };
  } catch (err) {
    throw new Exception(`Error with building transaction: ${err}`, {
      code: 400,
    });
  }
}

async function updateTransaction(
  clientTransactionId,
  bookingId,
  sessionId,
  body
) {
  logger.debug("Updating transaction: ", body);
  try {
    const transactionRecord = await getTransactionByTransactionId(
      clientTransactionId
    );
    logger.info("transactionRecord: ", transactionRecord);

    // If the transaction isn't 'in progress', we cannot alter it.
    if (transactionRecord.status !== "in progress") {
      throw new Exception(`Transaction cannot be altered at this state.`, {
        code: 400,
      });
    }

    // Throw an error if the bookingId doesn't match
    if (bookingId !== transactionRecord.bookingId) {
      throw new Exception(`Incorrect booking ID for this transaction.`, {
        code: 400,
      });
    }

    // Throw an error if the sessionId doesn't match
    if (sessionId !== transactionRecord.sessionId) {
      throw new Exception(`Incorrect session ID for this transaction.`, {
        code: 400,
      });
    }

    if (body?.trnApproved == 1) {
      body.status = "paid";
    } else {
      body.status = "cancelled";
    }

    return {
      key: { pk: transactionRecord.pk, sk: transactionRecord.sk },
      data: body,
    };
  } catch (error) {
    throw new Exception("Error updating transaction", {
      code: 400,
      error: error,
    });
  }
}

function createUrlWithHash(query, url) {
  // All values with the hash key appended to the end
  const allValues = `${query.toString()}${HASH_KEY}`;

  // Create an md5 hash
  const hashValue = createHash("md5").update(allValues).digest("hex");

  // We have our full URL with the hash value
  return `${url}?${query.toString()}&hashValue=${hashValue}`;
}

async function getTransactionByTransactionId(clientTransactionId) {
  logger.info(
    "Getting transaction by clientTransactionId:",
    clientTransactionId
  );
  try {
    return await getOneByGlobalId(clientTransactionId);
  } catch (error) {
    throw new Exception("Error getting transaction by clientTransactionId", {
      code: 400,
      error: error,
    });
  }
}

module.exports = {
  createTransaction,
  updateTransaction,
  getTransactionByTransactionId,
};
