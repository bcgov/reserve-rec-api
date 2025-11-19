const { Exception, getNow, logger } = require("/opt/base");
const { DateTime } = require("luxon");
const axios = require("axios");
const { getOne, getOneByGlobalId, putItem, runQuery, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const crypto = require('crypto');

const HASH_KEY = process.env.HASH_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;

function createHashExpiry() {
  const date = DateTime.now().plus({ minutes: 30 });
  return date.toFormat("yyyyLLddHHmm");
}

// Creates a transaction ID from the an input string, adds prefix
// needs to be less that 30 characters for Worldline to accept
function createWorldlineUuidWithPrefix(string, prefix) {
  const sliceLength = 30 - prefix.length;
  const uuidSlice = string.slice(0, sliceLength);
  return `${prefix}${uuidSlice}`;
}

// Creates the full Worldline URL with hash value appended
function createUrlWithHash(query, url) {
  // All values with the hash key appended to the end
  const allValues = `${query.toString()}${HASH_KEY}`;

  // Create an md5 hash
  const hashValue = crypto.createHash("md5").update(allValues).digest("hex");

  // We have our full URL with the hash value
  return `${url}?${query.toString()}&hashValue=${hashValue}`;
}

// ====== PAYMENT TRANSACTION ======

// Creates the Worldline URL for a single-payment, and inserts the transaction
// details into dynamo
async function createTransaction(body, user) {
  try {
    // Use booking ID to create our transaction ID
    const clientTransactionId = createWorldlineUuidWithPrefix(body.bookingId, "BCPR-");

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
      pk: `transaction::${clientTransactionId}`,
      sk: `details`,
      amount: body.trnAmount,
      bookingId: body.bookingId,
      clientTransactionId: clientTransactionId,
      date: today,
      globalId: clientTransactionId,
      sessionId: body.sessionId,
      schema: "transaction",
      transactionStatus: "in progress",
      transactionUrl: transactionUrl,
      user: user,
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

async function updateTransactionForPayment(
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
    if (transactionRecord.transactionStatus !== "in progress") {
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
      body.transactionStatus = "paid";
    } else {
      body.transactionStatus = "cancelled";
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

async function getTransactionByTransactionId(clientTransactionId) {
  logger.info(
    "Getting transaction by clientTransactionId:",
    clientTransactionId
  );
  try {
    return await getOneByGlobalId(clientTransactionId, TRANSACTIONAL_DATA_TABLE_NAME, 'globalId', 'globalId-index');
  } catch (error) {
    throw new Exception("Error getting transaction by clientTransactionId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

// ====== REFUNDS ======

// Finds, verifies, and returns the transaction if exists and belongs to the user
async function findAndVerifyTransactionOwnership(clientTransactionId, user) {
  logger.info("Getting transaction by clientTransactionId:", clientTransactionId);
  try {
    // Pull the transaction
    const transaction = await getOneByGlobalId(clientTransactionId, TRANSACTIONAL_DATA_TABLE_NAME, 'globalId', 'globalId-index');

    if (!transaction) {
      throw new Exception("Transaction not found", { code: 404 });
    }

    // Verify that the transaction belongs to the user or they are an admin
    // If the user is anonymous, we may need to handle differently
    const isOwner = transaction.user === user;
    const isAdmin = false; // TODO: Implement admin role check from JWT claims/context
    const transactionIsAnonymous = transaction.user === 'anonymous';
    
    // If user doesn't own it and isn't an admin, deny access
    if (!isOwner && !isAdmin) {
      // Special case: if the transaction is anonymous, we might want to allow
      // access via a different verification method, such as a one-time token or link?
      if (transactionIsAnonymous) {
        throw new Exception("Anonymous transaction requires verification", { code: 403 });
      }
      throw new Exception("Unauthorized access to transaction", { code: 401 });
    }

    // Return the transaction to be used for further processing
    return transaction;
  } catch (error) {
    // If it's already an Exception with a code, re-throw it as-is
    if (error instanceof Exception || error.code) {
      throw error;
    }
    // Otherwise wrap it as a generic error
    throw new Exception("Error getting transaction by clientTransactionId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

// Creates the refund hash and checks for duplicates
// Uses time window + refund sequence to prevent duplicates (while allowing multiple refunds)
async function createAndCheckRefundHash(user, clientTransactionId, trnAmount, windowMinutes = 3) {
  const now = getNow();
  const nowISO = now.toISO();
  const dateKey = now.toFormat("yyyy-LL-dd");
  const windowStart = now.minus({ minutes: windowMinutes });

  logger.info(`Checking for duplicate refunds within ${windowMinutes} minute window`);

  // Query all existing refunds for this transaction to check for:
  // 1. Recent duplicates (same amount within time window)
  // 2. Calculate refund sequence number
  const pk = `transaction::${clientTransactionId}`;
  const skPrefix = `refund::`;

  let existingRefunds = [];
  try {
    const refundQuery = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: pk },
        ":sk": { S: skPrefix },
      }
    };
    
    const queryResult = await runQuery(refundQuery);
    existingRefunds = queryResult.Items || [];
    logger.info(`Found ${existingRefunds.length} existing refund(s) for transaction ${clientTransactionId}`);
  } catch (error) {
    logger.error("Error querying existing refunds:", error);
  }

  // Check for duplicate: same amount within time window
  const recentDuplicate = existingRefunds.find(refund => {
    if (refund.amount !== trnAmount) {
      return false;
    } 
    
    // Check time and status
    const refundTime = DateTime.fromISO(refund.createdAt || refund.date);
    const isRecent = refundTime >= windowStart;
    const isActiveStatus = refund.transactionStatus === 'refund in progress' || refund.transactionStatus === 'refunded';
    
    if (isRecent && isActiveStatus) {
      logger.info(`Found recent refund: amount=${refund.amount}, time=${refundTime.toISO()}, status=${refund.transactionStatus}`);
      return true;
    }
    return false;
  });

  if (recentDuplicate) {
    logger.warn(`Duplicate refund of $${trnAmount} detected within ${windowMinutes} minutes`);
    throw new Exception("Duplicate refund attempt detected", { code: 409 });
  }

  // Calculate refund sequence and total refunded
  const refundCount = existingRefunds.length;
  const totalRefunded = existingRefunds.reduce((sum, refund) => {
    if (refund.transactionStatus === 'refunded' || refund.transactionStatus === 'refund in progress') {
      return sum + (refund.amount || 0);
    }
    return sum;
  }, 0);

  logger.info(`Refund sequence: ${refundCount + 1}, Total refunded so far: $${totalRefunded}`);

  // Generate unique hash with sequence number and timestamp to avoid collisions
  const hashString = `${user}::${clientTransactionId}::${trnAmount}::${refundCount}::${now.toMillis()}`;
  const refundHash = crypto.createHash('sha256').update(hashString).digest('hex');

  // Store refund hash record with some metadata
  const refundHashRecord = {
    pk: `refundHash::${dateKey}`,
    sk: refundHash,
    user: user,
    clientTransactionId: clientTransactionId,
    trnAmount: trnAmount,
    refundSequence: refundCount + 1,
    totalRefundedBefore: totalRefunded,
    createdAt: nowISO,
  };

  logger.info("Inserting refund hash record for idempotency:", refundHashRecord);

  // Insert the refund hash record into DynamoDB
  try {
    await putItem(refundHashRecord, TRANSACTIONAL_DATA_TABLE_NAME);
  } catch (error) {
    logger.error("Error inserting refund hash record:", error.message || error);
    throw new Exception("Error inserting refund hash record", {
      code: 400,
      error: error.message || String(error),
    });
  }

  // Return enhanced metadata for the refund
  return {
    refundHash,
    refundSequence: refundCount + 1,
    totalRefunded,
    totalAfterRefund: totalRefunded + trnAmount
  };
}

/**
 * Creates the Worldline URL for a single-payment, and inserts the refund
 * transaction details into dynamo
 * @param {object} transaction - Original transaction object
 * @param {number} refundAmount - Refund amount
 * @param {string} refundHash - Refund hash for idempotency
 * @param {object} body - Request body with optional refund reason
 * @param {string} body.reason - Reason for the refund
 * @param {number} body.refundSequence - Refund sequence number
 * @returns 
 */
async function createRefund(transaction, refundAmount, refundHash, obj) {
  try {
    // Generate a new refund transaction ID using part of the hash
    const refundTransactionId = createWorldlineUuidWithPrefix(refundHash, "RFND-");

    // Constructing the POST params for Worldline
    const url = `https://web.na.bambora.com/scripts/process_transaction.asp`;
    const params = new URLSearchParams({
      requestType: "BACKEND",
      merchant_id: MERCHANT_ID,
      trnType: "R",
      adjId: transaction.trnId, // Worldline original transaction ID
      trnAmount: `${refundAmount}`,
      trnOrderNumber: refundTransactionId, // New refund transaction ID
    });

    // Add hash value to params
    const paramsString = params.toString();
    const allValues = `${paramsString}${HASH_KEY}`;
    const hashValue = crypto.createHash("md5").update(allValues).digest("hex");
    params.append('hashValue', hashValue);

    // Store the prepared request URL for reference (will be used by Worldline processor)
    const refundTransactionUrl = `${url}?${params.toString()}`;
    logger.info("Refund request prepared for:", refundTransactionId);
    logger.info("Original transaction:", transaction.trnId);

    // Status starts as "refund in progress" - will be updated by Worldline processor
    let transactionStatus = "refund in progress";

    // Set part of the pk as today
    const today = getNow().toFormat("yyyy-LL-dd");

    // Items that will be inserted into dynamo for refund transaction
    const refundTransactionObj = {
      pk: `transaction::${transaction.clientTransactionId}`,
      sk: `refund::${refundTransactionId}`,
      amount: refundAmount,
      bookingId: transaction.bookingId,
      date: today,
      globalId: refundTransactionId,
      originalTransactionId: transaction.clientTransactionId,
      refundReason: obj?.reason || "No reason provided",
      refundSequence: obj?.refundSequence || 1,
      refundTransactionId: refundTransactionId,
      schema: "refund",
      transactionStatus: transactionStatus,
      transactionUrl: refundTransactionUrl,
      user: transaction.user
    };
    logger.info("refundTransactionObj: ", refundTransactionObj);

    return {
      key: { pk: refundTransactionObj.pk, sk: refundTransactionObj.sk },
      data: refundTransactionObj,
    };
  } catch (err) {
    throw new Exception(`Error with building transaction: ${err}`, {
      code: 400,
    });
  }
}

// Update original transaction status after refund
/**
 * 
 * @param {obj} transaction - Original transaction object
 * @param {number} refundAmount - Amount refunded in this transaction
 * @param {string} refundTransactionId - Refund transaction ID
 * @param {number} totalAfterRefund - Total amount refunded after this refund
 * @returns - Object for updating the original transaction
 */
async function updateTransactionForRefund(transaction, refundAmount, refundTransactionId, totalAfterRefund) {

  // Build the new refund entry as an object: { "RFND-xxx": amount }
  const newRefundEntry = { [refundTransactionId]: refundAmount };
  
  // Append to existing refundAmounts array (or create new array if it doesn't exist)
  const updatedRefundAmounts = [...(transaction.refundAmounts || []), newRefundEntry];

  // Update transaction status and refundAmounts array
  const updateOriginalTransaction = {
    key: {
      pk: transaction.pk,
      sk: transaction.sk,
    },
    data: {
      transactionStatus: "refund in progress", // update after Worldline processes
      refundAmounts: { value: updatedRefundAmounts, action: 'set' },
    }
  };
  
  logger.info("updateTransactionForRefund returning:", JSON.stringify(updateOriginalTransaction, null, 2));
  return updateOriginalTransaction;
}

async function getAllRefundsByTransactionId(clientTransactionId) {
  logger.info(
    "Getting all refunds by clientTransactionId:",
    clientTransactionId
  );

  try {
    const pk = `transaction::${clientTransactionId}`;
    const skPrefix = `refund::`;

    let refunds = [];
    try {
      // Query to get all refunds for the transaction
      const refundQuery = {
        TableName: TRANSACTIONAL_DATA_TABLE_NAME,
        KeyConditionExpression: skPrefix
          ? "pk = :pk AND begins_with (sk, :sk)"
          : "pk = :pk",
        ExpressionAttributeValues: skPrefix
          ? {
            ":pk": { S: pk },
            ":sk": { S: skPrefix },
          }
          : {
            ":pk": { S: pk },
          }
      };
      logger.debug(`refundQuery: ${refundQuery}`);
      const queryResult = await runQuery(refundQuery);

      refunds = [...queryResult.Items];
    } catch (error) {
      throw new Exception("Error running refund query for all items", {
        code: 400,
        error: error,
      });
    }

    return refunds;
  } catch (error) {
    throw new Exception("Error getting all refunds by transactionId", {
      code: 400,
      error: error,
    });
  }
}

async function getRefundByRefundId(clientTransactionId, refundId) {
  logger.info(
    "Getting refund by clientTransactionId and refundId:",
    clientTransactionId,
    refundId
  );
  try {
    const pk = `transaction::${clientTransactionId}`;
    const sk = `refund::${refundId}`;

    const refund = await getOne(pk, sk, TRANSACTIONAL_DATA_TABLE_NAME);
    
    if (!refund || refund.length === 0) {
      throw new Exception("Refund not found", { code: 404 });
    }

    return refund;
  } catch (error) {
    throw new Exception("Error getting refund by refundId", {
      code: 400,
      error: error,
    });
  }
}

module.exports = {
  createAndCheckRefundHash,
  createRefund,
  createTransaction,
  findAndVerifyTransactionOwnership,
  getTransactionByTransactionId,
  getAllRefundsByTransactionId,
  getRefundByRefundId,
  updateTransactionForPayment,
  updateTransactionForRefund
};
