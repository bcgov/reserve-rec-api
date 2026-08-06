const { DateTime } = require("luxon");
const axios = require("axios");
const crypto = require("crypto");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "ca-central-1",
});
let cachedSecrets = {};

const { Exception, getNow, getNowISO, logger } = require("/opt/base");
const {
  getOne,
  getOneByGlobalId,
  putItem,
  runQuery,
  TRANSACTIONAL_DATA_TABLE_NAME,
  batchTransactData,
} = require("/opt/dynamodb");
const {
  quickApiPutHandler,
  quickApiUpdateHandler,
} = require("../../common/data-utils");
const { TRANSACTION_PUT_CONFIG } = require("./configs");

const { BOOKING_UPDATE_CONFIG } = require("../bookings/configs");
const {
  completeBooking,
  sendBookingConfirmationEmail,
} = require("../bookings/methods");

const HASH_KEY = process.env.HASH_KEY;
const MERCHANT_ID = process.env.MERCHANT_ID;

/**
 * Dynamically retrieves a secret from AWS Secrets Manager by its path/name.
 * Cache is stored locally to avoid hitting AWS Secrets Manager API limits on repeat requests.
 *
 * @param {string} secretPath - The exact path name of the secret (e.g. process.env.MERCHANT_ID_SECRET)
 * @returns {Promise<string>} The plaintext secret value.
 * @throws {Error} If secretPath is missing or Secrets Manager API call fails.
 */
async function getSecret(secretPath) {
  if (!secretPath) {
    throw new Error(
      "Cannot retrieve secret: secretPath is undefined or empty.",
    );
  }

  if (cachedSecrets[secretPath]) {
    return cachedSecrets[secretPath];
  }

  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretPath }),
    );

    cachedSecrets[secretPath] = response.SecretString;
    return cachedSecrets[secretPath];
  } catch (error) {
    console.error(
      `Error retrieving secret [${secretPath}] from Secrets Manager:`,
      error,
    );
    throw error;
  }
}

/**
 * Creates a unique Worldline transaction identifier trimmed to meet length limits.
 * Worldline limits transaction IDs to 30 characters.
 *
 * @param {string} string - The base string or UUID slice to trim.
 * @param {string} prefix - The prefix to prepend (e.g., 'RFND-', 'BCPR-').
 * @returns {string} The formatted transaction string (<= 30 chars).
 */
function createWorldlineUuidWithPrefix(string, prefix) {
  const sliceLength = 30 - prefix.length;
  const uuidSlice = string.slice(0, sliceLength);
  return `${prefix}${uuidSlice}`;
}

/**
 * Appends an MD5 hash signature to a URL query parameter string for Worldline authentication.
 *
 * @param {URLSearchParams} query - The query parameters object.
 * @param {string} url - The base destination URL.
 * @returns {string} Complete URL with query string and MD5 hashValue parameter.
 */
function createUrlWithHash(query, url) {
  // All values with the hash key appended to the end
  const allValues = `${query.toString()}${HASH_KEY}`;

  // Create an md5 hash
  const hashValue = crypto.createHash("md5").update(allValues).digest("hex");

  // We have our full URL with the hash value
  return `${url}?${query.toString()}&hashValue=${hashValue}`;
}

/**
 * Validates transaction eligibility and constructs payment status update object.
 *
 * @param {string} clientTransactionId - The global transaction identifier.
 * @param {string} bookingId - The expected booking ID associated with the transaction.
 * @param {string} sessionId - The expected session ID associated with the transaction.
 * @param {Object} body - The webhook/callback body containing transaction approval status.
 * @param {number|string} body.trnApproved - Approval status flag (1 = approved).
 * @returns {Promise<Object>} An object containing key and data properties for DynamoDB update.
 * @throws {Exception} If transaction status is not 'in progress' or ID mismatches occur.
 */
async function updateTransactionForPayment(
  clientTransactionId,
  bookingId,
  sessionId,
  body,
) {
  logger.debug("Updating transaction: ", body);
  try {
    const transactionRecord =
      await getTransactionByTransactionId(clientTransactionId);
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

/**
 * Retrieves all transaction records associated with a given booking ID.
 *
 * @param {string} bookingId - The unique booking identifier.
 * @returns {Promise<Object>} Object containing query results from DynamoDB.
 * @throws {Exception} If the DynamoDB query operation fails.
 */
async function getTransactionsByBookingId(bookingId) {
  logger.info("Getting transaction by getTransactionsByBookingId:", bookingId);
  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `transaction::${bookingId}` },
      },
    };

    // Get a transactions for a specific bookingId (multiple attempts)
    const result = await runQuery(query);

    return result;
  } catch (error) {
    throw new Exception("Error getting transactions by bookingId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

/**
 * Retrieves transaction records for a specific booking ID filtered by date prefix.
 *
 * @param {string} bookingId - The unique booking identifier.
 * @param {string} date - Date string formatted as 'yyyy-MM-dd' to filter the sort key.
 * @returns {Promise<Object>} Object containing query results from DynamoDB.
 * @throws {Exception} If the DynamoDB query operation fails.
 */
async function getTransactionsByBookingIdDate(bookingId, date) {
  logger.info(
    "Getting transaction by getTransactionsByBookingIdDate:",
    `${bookingId} and ${date}`,
  );
  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `transaction::${bookingId}` },
      },
    };

    // All transactions will have the date as the start of the sk
    // So fetch all transaction for a bookingId for a specific date
    query.KeyConditionExpression += " AND begins_with(sk, :skPrefix)";
    query.ExpressionAttributeValues[":skPrefix"] = { S: date };

    const result = await runQuery(query);

    return result;
  } catch (error) {
    throw new Exception("Error getting transactions by bookingId and date", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

/**
 * Retrieves a single transaction record using its global transaction ID using GSI lookup.
 *
 * @param {string} clientTransactionId - The unique global transaction identifier.
 * @returns {Promise<Object|null>} The transaction object if found, or null.
 * @throws {Exception} If the DynamoDB query fails.
 */
async function getTransactionByTransactionId(clientTransactionId) {
  logger.info(
    "Getting transaction by clientTransactionId:",
    clientTransactionId,
  );
  try {
    return await getOneByGlobalId(
      clientTransactionId,
      TRANSACTIONAL_DATA_TABLE_NAME,
      "globalId",
      "globalId-index",
    );
  } catch (error) {
    throw new Exception("Error getting transaction by clientTransactionId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

// ====== REFUNDS ======

/**
 * Verifies that a transaction exists and belongs to the requesting user.
 *
 * @param {string} clientTransactionId - The global transaction identifier.
 * @param {string} userId - The user ID to verify against the transaction owner.
 * @returns {Promise<Object>} The verified transaction record.
 * @throws {Exception} 404 if transaction is not found, 401 if user is unauthorized, 400 on error.
 */
async function findAndVerifyTransactionOwnership(clientTransactionId, userId) {
  logger.info(
    "Getting transaction by clientTransactionId:",
    clientTransactionId,
  );
  try {
    const transaction = await getOneByGlobalId(
      clientTransactionId,
      TRANSACTIONAL_DATA_TABLE_NAME,
      "globalId",
      "globalId-index",
    );

    if (!transaction) {
      throw new Exception("Transaction not found", { code: 404 });
    }

    if (transaction.userId !== userId) {
      throw new Exception("Unauthorized access to transaction", { code: 401 });
    }

    return transaction;
  } catch (error) {
    if (error instanceof Exception || error.code) throw error;
    throw new Exception("Error getting transaction by clientTransactionId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

/**
 * Prevents rapid duplicate refund submissions and calculates sequence metadata.
 * Stores a hash audit record in DynamoDB.
 *
 * @param {string} userId - The ID of the user requesting the refund.
 * @param {string} clientTransactionId - The original transaction identifier.
 * @param {number} refundAmount - The amount being requested for refund.
 * @param {string} bookingId - The booking ID associated with the transaction.
 * @param {number} [windowMinutes=3] - Lookback window to detect rapid duplicate attempts.
 * @returns {Promise<Object>} Object containing refundHash, refundSequence, totalRefunded, and totalAfterRefund.
 * @throws {Exception} 409 if duplicate attempt is detected within the time window, 400 on failure.
 */
async function createAndCheckRefundHash(
  userId,
  clientTransactionId,
  refundAmount,
  bookingId,
  windowMinutes = 3,
) {
  const now = getNow();
  const nowISO = getNowISO();
  const dateKey = now.toFormat("yyyy-LL-dd");
  const windowStart = now.minus({ minutes: windowMinutes });

  // Query existing refunds for sequence and totals
  const pk = `transaction::${bookingId}`;
  const skPrefix = `refund::`; // Match all historical refunds for this booking

  let existingRefunds = [];
  try {
    const refundQuery = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: pk },
        ":sk": { S: skPrefix },
      },
    };

    const queryResult = await runQuery(refundQuery);
    existingRefunds = queryResult.items || [];
    logger.info(
      `Found ${existingRefunds.length} existing refund(s) for booking ${bookingId}`,
    );
  } catch (error) {
    logger.error("Error querying existing refunds:", error);
  }

  // Check for recent active duplicates
  const recentDuplicate = existingRefunds.find((refund) => {
    if (Number(refund.amount) !== Number(refundAmount)) return false;

    const refundTime = DateTime.fromISO(refund.createdAt || refund.date);
    const isRecent = refundTime >= windowStart;
    const isActiveStatus =
      refund.status === "refund in progress" || refund.status === "refunded";

    return isRecent && isActiveStatus;
  });

  if (recentDuplicate) {
    throw new Exception("Duplicate refund attempt detected", { code: 409 });
  }

  // Calculate sequence and total refunded so far
  // TODO: this should be expanded to compare the total refund amount and
  // check the Booking's Policy's maximum allowed refund amount, refund window, etc.
  const refundCount = existingRefunds.length;
  const totalRefunded = existingRefunds.reduce((sum, refund) => {
    if (["refunded", "refund in progress"].includes(refund.status)) {
      return sum + Number(refund.amount || 0);
    }
    return sum;
  }, 0);

  // Generate hash based on a time-window bucket
  // All requests within the same N-minute window get the same bucket integer
  const windowBucket = Math.floor(now.toMillis() / (windowMinutes * 60 * 1000));
  const hashString = `${userId}::${clientTransactionId}::${refundAmount}::${windowBucket}`;
  const refundHash = crypto
    .createHash("sha256")
    .update(hashString)
    .digest("hex");

  const refundHashRecord = {
    pk: `refundHash::${dateKey}`,
    sk: refundHash,
    userId: userId,
    clientTransactionId: clientTransactionId,
    bookingId: bookingId,
    refundAmount: refundAmount,
    refundSequence: refundCount + 1,
    totalRefundedBefore: totalRefunded,
    createdAt: nowISO,
    refundHash: refundHash,
    globalId: refundHash,
  };

  // Attempt to write - DynamoDB will block duplicate requests
  try {
    await putItem(
      refundHashRecord,
      TRANSACTIONAL_DATA_TABLE_NAME,
      "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    );
  } catch (error) {
    if (
      error.name === "ConditionalCheckFailedException" ||
      error.code === "ConditionalCheckFailedException" ||
      error.message?.includes("conditional")
    ) {
      throw new Exception("Duplicate refund attempt detected", { code: 409 });
    }

    if (error instanceof Exception) throw error;

    throw new Exception("Error inserting refund hash record", {
      code: 400,
      error: error.message || String(error),
    });
  }

  return {
    refundHash,
    refundSequence: refundCount + 1,
    totalRefunded,
    totalAfterRefund: totalRefunded + Number(refundAmount),
  };
}

/**
 * Issues a refund request to Worldline's process_transaction.asp legacy endpoint.
 *
 * @param {Object} transaction - Original transaction record.
 * @param {number} refundAmount - Amount to be refunded.
 * @param {Object|string} refundHashObj - Hash result object or hash string from createAndCheckRefundHash.
 * @param {Object} [bodyObj] - Request body containing optional refund metadata (e.g., reason).
 * @param {string} [bodyObj.reason] - Human-readable reason for issuing the refund.
 * @returns {Promise<Object>} Formatted object containing DynamoDB key and created refund record.
 * @throws {Exception} 400 if original transaction ID is missing, or if Worldline declines the request.
 */
async function createRefund(transaction, refundAmount, refundHashObj, bodyObj) {
  try {
    const hashString =
      typeof refundHashObj === "object"
        ? refundHashObj.refundHash
        : refundHashObj;

    const refundTransactionId = createWorldlineUuidWithPrefix(
      hashString,
      "RFND-",
    );

    const merchantId = await getSecret(process.env.MERCHANT_ID_SECRET);
    const hashKey = await getSecret(process.env.HASH_KEY_SECRET);

    const originalWorldlineId =
      transaction.trnId || transaction.processorTransactionId;
    if (!originalWorldlineId) {
      throw new Exception("Original transaction missing Worldline ID (trnId)", {
        code: 400,
      });
    }

    // Worldline Legacy Process API
    const url = `https://web.na.bambora.com/scripts/process_transaction.asp`;
    const params = new URLSearchParams({
      requestType: "BACKEND",
      merchant_id: merchantId,
      trnType: "R",
      adjId: originalWorldlineId,
      trnAmount: `${Number(refundAmount).toFixed(2)}`,
      trnOrderNumber: refundTransactionId,
    });

    const paramsString = params.toString();
    const allValues = `${paramsString}${hashKey}`;
    const hashValue = crypto.createHash("md5").update(allValues).digest("hex");
    params.append("hashValue", hashValue);

    logger.info(
      `Sending refund request to Worldline for transaction ${originalWorldlineId}`,
    );

    const response = await axios.post(url, params.toString(), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const responseParams = new URLSearchParams(response.data);
    const trnApproved = responseParams.get("trnApproved");
    const trnMessageText =
      responseParams.get("messageText") || "Refund processed";
    const worldlineRefundId = responseParams.get("trnId");

    const isSuccess = trnApproved === "1";
    const status = isSuccess ? "refunded" : "refund failed";
    const today = getNow().toFormat("yyyy-LL-dd");

    // Align PK and SK with main transaction
    const refundTransactionObj = {
      pk: `transaction::${transaction.bookingId}`,
      sk: `refund::${today}::${refundTransactionId}`,
      amount: Number(refundAmount),
      bookingId: transaction.bookingId,
      date: today,
      globalId: refundTransactionId,
      originalTransactionId: transaction.clientTransactionId,
      processorRefundId: worldlineRefundId,
      refundReason: bodyObj?.reason || "Admin initiated refund",
      refundSequence: refundHashObj?.refundSequence || 1,
      refundHash: refundHashObj.refundHash,
      refundTransactionId: refundTransactionId,
      schema: "refund",
      status: status,
      trnMessage: trnMessageText,
      userId: transaction.userId,
    };

    if (!isSuccess) {
      throw new Exception(`Worldline refund declined: ${trnMessageText}`, {
        code: 400,
        data: { refundTransactionObj },
      });
    }

    return {
      key: { pk: refundTransactionObj.pk, sk: refundTransactionObj.sk },
      data: refundTransactionObj,
    };
  } catch (err) {
    if (err instanceof Exception) throw err;
    throw new Exception(
      `Error processing refund with Worldline: ${err.message || err}`,
      {
        code: 400,
      },
    );
  }
}

/**
 * Builds the update payload for marking the original transaction as 'refund in progress'.
 *
 * @param {Object} transaction - Original transaction object from DynamoDB.
 * @param {number} refundAmount - Amount refunded in this transaction.
 * @param {string} refundTransactionId - Unique refund transaction ID (RFND-xxx).
 * @param {number} totalAfterRefund - Cumulative total refunded including this request.
 * @returns {Promise<Object>} Update command payload structured for DynamoDB.
 */
async function updateTransactionForRefund(
  transaction,
  refundAmount,
  refundTransactionId,
  totalAfterRefund,
) {
  // Build the new refund entry as an object: { "RFND-xxx": amount }
  const newRefundEntry = { [refundTransactionId]: refundAmount };

  // Append to existing refundAmounts array (or create new array if it doesn't exist)
  const updatedRefundAmounts = [
    ...(transaction.refundAmounts || []),
    newRefundEntry,
  ];

  // Update transaction status and refundAmounts array
  const updateOriginalTransaction = {
    key: {
      pk: transaction.pk,
      sk: transaction.sk,
    },
    data: {
      status: "refund in progress", // update after Worldline processes
      refundAmounts: { value: updatedRefundAmounts, action: "set" },
    },
  };

  logger.info(
    "updateTransactionForRefund returning:",
    JSON.stringify(updateOriginalTransaction, null, 2),
  );
  return updateOriginalTransaction;
}

/**
 * Fetches all refund records associated with a given bookingId.
 *
 * @param {string} bookingId - Booking ID to query.
 * @returns {Promise<Array<Object>>} List of refund items found.
 * @throws {Exception} 400 if the database query fails.
 */
async function getAllRefundsByBookingId(bookingId) {
  logger.info("Getting all refunds by bookingId:", bookingId);

  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :sk)",
      ExpressionAttributeValues: {
        ":pk": { S: `transaction::${bookingId}` },
        ":sk": { S: "refund::" },
      },
    };

    // Get a transactions for a specific bookingId (multiple attempts)
    const result = await runQuery(query);

    return result.items || [];
  } catch (error) {
    throw new Exception("Error getting refunds by bookingId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

/**
 * Retrieves a single refund item by its unique global refund ID.
 *
 * @param {string} bookingId - Booking id of the transaction.
 * @param {string} refundId - Unique refund global ID (e.g., RFND-xxx).
 * @returns {Promise<Object>} The refund item.
 * @throws {Exception} 404 if refund does not exist, 400 on query error, 401 on unauthorized.
 */
async function getRefundByRefundId(bookingId, refundId) {
  logger.info("Getting refund by bookingId and refundId:", bookingId, refundId);

  try {
    const refund = await getOneByGlobalId(
      refundId,
      TRANSACTIONAL_DATA_TABLE_NAME,
      "globalId",
      "globalId-index",
    );

    if (!refund) {
      throw new Exception("Refund not found", { code: 404 });
    }

    if (refund.bookingId !== bookingId) {
      throw new Exception(
        "The bookingId provided does not match refund's bookingId",
        { code: 401 },
      );
    }

    return refund;
  } catch (error) {
    if (error instanceof Exception) throw error;

    throw new Exception("Error getting refund by refundId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

// ====== PAYMENT TRANSACTION ======

/**
 * Fetches a booking and validates if it is eligible for payment.
 * @param {string} bookingId - The global ID of the booking to validate.
 * @param {string} userId - The sub/ID of the user attempting to make the payment.
 * @returns {Promise<Object>} The validated booking record from DynamoDB.
 * @throws {Exception} Throws an Exception if the booking is not found, unauthorized, paid, cancelled, or expired.
 */
async function fetchAndValidateBooking(bookingId, userId) {
  const bookingRecord = await getOneByGlobalId(
    bookingId,
    TRANSACTIONAL_DATA_TABLE_NAME,
    "globalId",
    "globalId-index",
  );

  if (!bookingRecord) {
    throw new Exception("Booking not found", { code: 404 });
  }

  // Confirm the user in the body request owns the booking
  if (bookingRecord.userId !== userId) {
    logger.warn(
      `Unauthorized transaction attempt: user ${userId} tried to pay for booking owned by ${bookingRecord.userId}`,
    );
    throw new Exception("Unauthorized: You do not own this booking", {
      code: 403,
    });
  }

  if (bookingRecord.status === "confirmed") {
    throw new Exception("Booking has already been paid", { code: 400 });
  }

  if (bookingRecord.status === "cancelled") {
    throw new Exception("Booking has been cancelled", { code: 400 });
  }

  // If booking's sessionExpiry exists (not admin), we want to make sure
  // the booking payment is still within the valid booking window
  if (bookingRecord.sessionExpiry) {
    const expiryTime = new Date(bookingRecord.sessionExpiry).getTime();
    if (Date.now() > expiryTime) {
      logger.warn(
        `Expired session: booking ${bookingId} expired at ${bookingRecord.sessionExpiry}`,
      );
      throw new Exception(
        "Booking session has expired. Please create a new booking.",
        { code: 410 },
      );
    }
  }

  return bookingRecord;
}

/**
 * Submits a tokenized payment request to the Worldline REST API.
 * @param {string} clientTransactionId - The unique generated ID for this specific transaction attempt.
 * @param {number} transactionAmount - The total amount to charge to the card.
 * @param {Object} body - The raw request body containing token and billing details.
 * @param {Object|null} bookingRecord - The booking record (used as a fallback to extract user email).
 * @returns {Promise<Object>} An object containing standard payment response flags.
 */
async function executeWorldlinePayment(
  clientTransactionId,
  transactionAmount,
  body,
  bookingRecord,
) {
  const paymentsApiPasscode = await getSecret(process.env.PAYMENTS_API_SECRET);
  const merchantId = await getSecret(process.env.MERCHANT_ID_SECRET);
  const hashKey = await getSecret(process.env.HASH_KEY_SECRET);

  logger.info(
    `Submitting token checkout payment to Worldline for transaction: ${clientTransactionId}`,
  );

  const paymentApiUrl =
    process.env.WORLDLINE_PAYMENT_API_URL ||
    "https://api.na.bambora.com/v1/payments";
  const basicAuthToken = Buffer.from(
    `${merchantId}:${paymentsApiPasscode}`,
  ).toString("base64");

  // Note: this should have everything the user has passed into the payment form AND
  // should have the user's details from their Cognito account (address, postal code).
  // - Anything fraudulent gets flagged by Worldline (fake postal code, fake province code, etc).
  // - Anything empty or mismatched from the card's info (from bank) is noted by Worldline.
  const payload = {
    payment_method: "token",
    order_number: clientTransactionId,
    amount: Number(transactionAmount.toFixed(2)),
    token: {
      code: body.token,
      name: body.cardholderName,
      complete: true,
    },
    // Capture the bookingId, sessionId, and email for easier lookup from Worldline trn
    custom: {
      ref1: body?.bookingId,
      ref2: body?.sessionId,
      ref3: body?.email || bookingRecord?.namedOccupant?.contactInfo?.email,
    },
    billing: {
      name: body?.cardholderName || "",
      address_line1: body?.address1 || "",
      address_line2: body?.address2 || "",
      city: body?.city || "",
      province: body?.province || "",
      country: body?.country || "",
      postal_code: body?.postalCode || "",
      phone_number: body?.phoneNumber || "",
      email_address: body?.email || "",
    },
  };

  // Attempt to POST the payment to Worldline with the payload
  try {
    const res = await axios.post(paymentApiUrl, payload, {
      headers: {
        Authorization: `Passcode ${basicAuthToken}`,
        "Content-Type": "application/json",
      },
    });

    const wlResponse = res.data;
    const isApproved =
      wlResponse?.approved === 1 ||
      wlResponse?.approved === true ||
      wlResponse?.approved === "1";

    return {
      data: res.data,
      status: isApproved ? "paid" : "failed",
      errorStatusCode: null,
      errorDetailsObj: null,
    };
  } catch (postError) {
    logger.error(
      "Worldline REST direct API charge failed:",
      postError.message,
      postError.response?.data,
    );
    const errDetails = postError.response?.data || {};

    return {
      status: "failed",
      clientTransactionId: "",
      message: errDetails.message || postError.message,
      authCode: "",
      errorStatusCode: postError.response?.status || 400,
      errorDetailsObj: errDetails,
    };
  }
}

/**
 * Handle modern secure Custom Checkout (Tokenized Payment via Bambora/Worldline API)
 * Directly performs payment transaction against Worldline REST API and completes the booking atomically.
 * @param {Object} body - The parsed JSON body from the HTTP event.
 * @param {string} userId - The sub identifier of the requesting user.
 * @param {string} adminId - The sub identifier for the admin issuing payment (admin-only)
 * @returns {Promise<Object>} The final payment result and transaction state to return to the client.
 * @throws {Exception} Throws if payment fails or internal processing errors occur.
 */
async function processTokenTransaction(body, userId, adminId) {
  try {
    let bookingRecord = null;
    let transactionAmount = body.trnAmount || 0;

    try {
      bookingRecord = await fetchAndValidateBooking(body.bookingId, userId);
      transactionAmount = bookingRecord.feeValues?.bookingTotal;
    } catch (err) {
      // Re-throw the exception, but add some items for admin audit
      throw new Exception(
        err?.message || "Error fetching and validating booking",
        {
          code: err?.code || 400,
          message: err?.msg || "Error fetching and validating booking",
          data: {
            adminId: adminId,
            bookingId: body?.bookingId,
            body: body,
          },
        },
      );
    }

    // Create the Worldline transaction prefix
    const clientTransactionId = createWorldlineUuidWithPrefix(
      crypto.randomUUID(),
      "BCPR-",
    );

    // Create the Worldline transaction
    const paymentResult = await executeWorldlinePayment(
      clientTransactionId,
      transactionAmount,
      body,
      bookingRecord,
    );

    const today = getNow().toFormat("yyyy-LL-dd");

    // Cleanly map the database record without mutating paymentResult
    const transactionObj = {
      pk: `transaction::${body.bookingId}`,
      sk: `${today}::${clientTransactionId}`,
      amount: transactionAmount,
      bookingId: body.bookingId,
      clientTransactionId: clientTransactionId,
      date: today,
      globalId: clientTransactionId,
      schema: "transaction",
      sessionId: body.sessionId,
      status: paymentResult?.status,
      userId: userId,
      cardAvsAddrMatch: paymentResult?.data?.card?.address_match,
      cardAvsId: paymentResult?.data?.card?.avs?.id,
      cardAvsMessage: paymentResult?.data?.card?.avs?.message,
      cardAvsPostalResult: paymentResult?.data?.card?.postal_result,
      cardAvsProcessed: paymentResult?.data?.card?.avs?.processed,
      cardAvsResult: paymentResult?.data?.card?.avs_result,
      cardBin: paymentResult?.data?.card?.card_bin,
      cardCvdId: paymentResult?.data?.card?.cvd_result,
      cardLastFour: paymentResult?.data?.card?.last_four,
      cardType: paymentResult?.data?.card?.card_type,
      customRef1: paymentResult?.data?.custom?.ref1,
      customRef2: paymentResult?.data?.custom?.ref2,
      customRef3: paymentResult?.data?.custom?.ref3,
      customRef4: paymentResult?.data?.custom?.ref4,
      customRef5: paymentResult?.data?.custom?.ref5,
      trnAmount: paymentResult?.data?.amount,
      trnApproved: paymentResult?.data?.approved,
      trnAuthCode: paymentResult?.data?.auth_code,
      // trnCustomerName: body?.
      trnCreated: paymentResult?.data?.created,
      // trnEmailAddress: body?.
      trnId: paymentResult?.data?.id,
      trnMessage: paymentResult?.data?.message,
      trnOrderNumber: paymentResult?.data?.order_number,
      trnPaymentMethod: paymentResult?.data?.payment_method,
      // trnPhoneNumber: body?.,
      trnRiskScore: paymentResult?.data?.risk_score,
      trnType: paymentResult?.data?.type,
      trnLinks: paymentResult?.data?.links,
      // Slap it all in there as metadata
      metadata: paymentResult?.data,
    };

    // Remove anything that's undefined
    Object.keys(transactionObj).forEach((key) => {
      if (transactionObj[key] === undefined) {
        delete transactionObj[key];
      }
    });

    const putItemsTransaction = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [
        {
          key: { pk: transactionObj.pk, sk: transactionObj.sk },
          data: transactionObj,
        },
      ],
      TRANSACTION_PUT_CONFIG,
    );

    // Handle failed payment write
    if (
      paymentResult.status !== "paid" ||
      paymentResult.data?.approved != "1"
    ) {
      await batchTransactData(putItemsTransaction);

      // Throw an error that captures the adminId, for admin payments
      throw new Exception(
        `Worldline Payment Transaction Failed: ${paymentResult?.message}`,
        {
          code: paymentResult.errorStatusCode || 400,
          error: paymentResult.errorDetailsObj || null,
          data: {
            adminId: adminId,
            bookingId: body?.bookingId,
            body: body,
            transaction: transactionObj,
          },
        },
      );
    }

    // Handle standard successful write and complete booking
    const { updateRequests, emailParams } = await completeBooking(
      body.bookingId,
      body.sessionId,
      { clientTransactionId: clientTransactionId, queryTime: Date.now() },
      { sub: userId },
    );

    const putItemsBooking = await quickApiUpdateHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [updateRequests],
      BOOKING_UPDATE_CONFIG,
    );

    await batchTransactData([...putItemsTransaction, ...putItemsBooking]);
    logger.info(
      `Successfully stored paid transaction ${clientTransactionId} and finalized booking ${body.bookingId}`,
    );

    // Side effects (emails)
    if (emailParams) {
      sendBookingConfirmationEmail(emailParams, userId).catch((emailErr) => {
        logger.error(
          "Asynchronous booking confirmation email trigger failed:",
          emailErr,
        );
      });
    }

    return {
      success: true,
      status: "paid",
      clientTransactionId: clientTransactionId,
      message: paymentResult?.data?.message,
      transaction: transactionObj,
    };
  } catch (err) {
    if (err instanceof Exception) throw err;
    const message = `Error processing token transaction: ${err.message || err}`;
    throw new Exception(message, {
      code: 400,
      message: message,
      data: {
        adminId: adminId,
        bookingId: body?.bookingId,
        body: body,
      },
    });
  }
}

module.exports = {
  createWorldlineUuidWithPrefix,
  createAndCheckRefundHash,
  createRefund,
  processTokenTransaction,
  findAndVerifyTransactionOwnership,
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate,
  getTransactionByTransactionId,
  getAllRefundsByBookingId,
  getRefundByRefundId,
  updateTransactionForPayment,
  updateTransactionForRefund,
};
