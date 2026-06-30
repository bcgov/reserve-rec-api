const { DateTime } = require("luxon");
const axios = require("axios");
const crypto = require("crypto");

const { Exception, getNow, logger } = require("/opt/base");
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

async function getTransactionsByBookingId(bookingId) {
  logger.info(
    "Getting transaction by getTransactionsByBookingId:",
    bookingId,
  );
  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `transaction::${bookingId}` }
      }
    }

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

async function getTransactionsByBookingIdDate(bookingId, date) {
  logger.info(
    "Getting transaction by getTransactionsByBookingIdDate:",
    `${bookingId} and ${date}`,
  );
  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `transaction::${bookingId}` }
      }
    }

    // All transactions will have the date as the start of the sk
    // So fetch all transaction for a bookingId for a specific date
    query.KeyConditionExpression += ' AND begins_with(sk, :skPrefix)';
    query.ExpressionAttributeValues[':skPrefix'] = { S: date };

    const result = await runQuery(query);
    
    return result;
  } catch (error) {
    throw new Exception("Error getting transactions by bookingId and date", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

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

// Finds, verifies, and returns the transaction if exists and belongs to the user
async function findAndVerifyTransactionOwnership(clientTransactionId, userId) {
  logger.info(
    "Getting transaction by clientTransactionId:",
    clientTransactionId,
  );
  try {
    // Pull the transaction
    const transaction = await getOneByGlobalId(
      clientTransactionId,
      TRANSACTIONAL_DATA_TABLE_NAME,
      "globalId",
      "globalId-index",
    );

    if (!transaction) {
      throw new Exception("Transaction not found", { code: 404 });
    }

    // Verify that the transaction belongs to the userId or they are an admin
    // If the user is anonymous, we may need to handle differently
    const isOwner = transaction.userId === userId;
    const isAdmin = false; // TODO: Implement admin role check from JWT claims/context
    const transactionIsAnonymous = transaction.userId === "anonymous";

    // If user doesn't own it and isn't an admin, deny access
    if (!isOwner && !isAdmin) {
      // Special case: if the transaction is anonymous, we might want to allow
      // access via a different verification method, such as a one-time token or link?
      if (transactionIsAnonymous) {
        throw new Exception("Anonymous transaction requires verification", {
          code: 403,
        });
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
async function createAndCheckRefundHash(
  userId,
  clientTransactionId,
  trnAmount,
  windowMinutes = 3,
) {
  const now = getNow();
  const nowISO = now.toISO();
  const dateKey = now.toFormat("yyyy-LL-dd");
  const windowStart = now.minus({ minutes: windowMinutes });

  logger.info(
    `Checking for duplicate refunds within ${windowMinutes} minute window`,
  );

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
      },
    };

    const queryResult = await runQuery(refundQuery);
    existingRefunds = queryResult.Items || [];
    logger.info(
      `Found ${existingRefunds.length} existing refund(s) for transaction ${clientTransactionId}`,
    );
  } catch (error) {
    logger.error("Error querying existing refunds:", error);
  }

  // Check for duplicate: same amount within time window
  const recentDuplicate = existingRefunds.find((refund) => {
    if (refund.amount !== trnAmount) {
      return false;
    }

    // Check time and status
    const refundTime = DateTime.fromISO(refund.createdAt || refund.date);
    const isRecent = refundTime >= windowStart;
    const isActiveStatus =
      refund.transactionStatus === "refund in progress" ||
      refund.transactionStatus === "refunded";

    if (isRecent && isActiveStatus) {
      logger.info(
        `Found recent refund: amount=${refund.amount}, time=${refundTime.toISO()}, status=${refund.transactionStatus}`,
      );
      return true;
    }
    return false;
  });

  if (recentDuplicate) {
    logger.warn(
      `Duplicate refund of $${trnAmount} detected within ${windowMinutes} minutes`,
    );
    throw new Exception("Duplicate refund attempt detected", { code: 409 });
  }

  // Calculate refund sequence and total refunded
  const refundCount = existingRefunds.length;
  const totalRefunded = existingRefunds.reduce((sum, refund) => {
    if (
      refund.transactionStatus === "refunded" ||
      refund.transactionStatus === "refund in progress"
    ) {
      return sum + (refund.amount || 0);
    }
    return sum;
  }, 0);

  logger.info(
    `Refund sequence: ${refundCount + 1}, Total refunded so far: $${totalRefunded}`,
  );

  // Generate unique hash with sequence number and timestamp to avoid collisions
  const hashString = `${userId}::${clientTransactionId}::${trnAmount}::${refundCount}::${now.toMillis()}`;
  const refundHash = crypto
    .createHash("sha256")
    .update(hashString)
    .digest("hex");

  // Store refund hash record with some metadata
  const refundHashRecord = {
    pk: `refundHash::${dateKey}`,
    sk: refundHash,
    userId: userId,
    clientTransactionId: clientTransactionId,
    trnAmount: trnAmount,
    refundSequence: refundCount + 1,
    totalRefundedBefore: totalRefunded,
    createdAt: nowISO,
  };

  logger.info(
    "Inserting refund hash record for idempotency:",
    refundHashRecord,
  );

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
    totalAfterRefund: totalRefunded + trnAmount,
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
    const refundTransactionId = createWorldlineUuidWithPrefix(
      refundHash,
      "RFND-",
    );

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
    params.append("hashValue", hashValue);

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
      userId: transaction.userId,
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
      transactionStatus: "refund in progress", // update after Worldline processes
      refundAmounts: { value: updatedRefundAmounts, action: "set" },
    },
  };

  logger.info(
    "updateTransactionForRefund returning:",
    JSON.stringify(updateOriginalTransaction, null, 2),
  );
  return updateOriginalTransaction;
}

async function getAllRefundsByTransactionId(clientTransactionId) {
  logger.info(
    "Getting all refunds by clientTransactionId:",
    clientTransactionId,
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
            },
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
    refundId,
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

  if (bookingRecord.bookingStatus === "confirmed") {
    throw new Exception("Booking has already been paid", { code: 400 });
  }

  if (bookingRecord.bookingStatus === "cancelled") {
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
  const paymentsApiPasscode = process.env.PAYMENTS_API_PASSCODE;
  const merchantId = process.env.MERCHANT_ID;

  logger.info(
    `Submitting token checkout payment to Worldline for transaction: ${clientTransactionId}`,
  );

  const paymentApiUrl =
    process.env.WORLDLINE_PAYMENT_API_URL || "https://api.na.bambora.com/v1/payments";
  const basicAuthToken = Buffer.from(`${merchantId}:${paymentsApiPasscode}`,).toString("base64");

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

    const isStandaloneTest = body.bookingId === "standalone-test" || body.bookingId?.startsWith("test-");

    // Try to validate booking - if it fails, catch and re-throw error for more fulsome
    // error data item.
    if (!isStandaloneTest) {
      try {
        bookingRecord = await fetchAndValidateBooking(body.bookingId, userId);
        transactionAmount = bookingRecord.feeValues?.bookingTotal;
      } catch (err) {
        // Re-throw the exception, but add some items for admin audit
        throw new Exception(err?.message || "Error fetching and validating booking",
          {
            code: err?.code || 400,
            message: err?.msg || "Error fetching and validating booking",
            data: {
              adminId: adminId,
              bookingId: body?.bookingId,
              body: body
            }
          },
        );
      }
    } else {
      logger.info(`Bypassing booking checks: Standalone direct payment test request from user ${adminId}`);
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
      amount : transactionAmount,
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
    Object.keys(transactionObj).forEach(key => {
      if (transactionObj[key] === undefined) {
        delete transactionObj[key];
      }
    });

    if (transactionObj.rawGatewayResponse) {
      delete transactionObj.rawGatewayResponse.authorizing_merchant_id;
    }

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
    if (paymentResult.status !== "paid" || paymentResult.data?.approved != "1") {
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
          }
        },
      );
    }

    if (isStandaloneTest) {
      await batchTransactData(putItemsTransaction);
      logger.info(
        `Successfully stored paid standalone test transaction ${clientTransactionId}`,
      );
      return {
        success: true,
        transactionStatus: "paid",
        clientTransactionId: clientTransactionId,
        message: paymentResult?.data?.message,
        transaction: transactionObj,
      };
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
      transactionStatus: "paid",
      clientTransactionId: clientTransactionId,
      message: paymentResult?.data?.message,
      transaction: transactionObj,
    };
  } catch (err) {
    if (err instanceof Exception) throw err;
    const message = `Error processing token transaction: ${err.message || err}`;
    throw new Exception(
      message,
      { 
        code: 400,
        message: message,
        data: {
          adminId: adminId,
          bookingId: body?.bookingId,
          body: body,
        }
      },
    );
  }
}

module.exports = {
  createAndCheckRefundHash,
  createRefund,
  processTokenTransaction,
  findAndVerifyTransactionOwnership,
  getTransactionsByBookingId,
  getTransactionsByBookingIdDate,
  getTransactionByTransactionId,
  getAllRefundsByTransactionId,
  getRefundByRefundId,
  updateTransactionForPayment,
  updateTransactionForRefund,
};
