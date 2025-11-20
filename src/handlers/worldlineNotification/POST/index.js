// Await Worldline Notification push
const querystring = require('querystring');
const { Exception, logger, sendResponse } = require("/opt/base");
const { updateTransactionForPayment } = require("../../transactions/methods");
const { batchTransactData, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { quickApiUpdateHandler } = require("../../../common/data-utils");
const { TRANSACTION_UPDATE_CONFIG } = require("../../transactions/configs");

const WORLDLINE_WEBHOOK_SECRET = process.env.WORLDLINE_WEBHOOK_SECRET || 'default-secret'

// Update booking
const { completeBooking } = require("../../bookings/methods")
const { BOOKING_UPDATE_CONFIG } = require("../../bookings/configs");

// Email dispatch
const { sendReceiptEmail, getRegionBranding } = require("../../../../lib/handlers/emailDispatch/utils");

exports.handler = async (event, context) => {
  logger.info("Worldline Notification POST:", event);

  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  try {
    // Get relevant data from the event
    const secret = event?.queryStringParameters?.webhookSecret;
    
    // Take the body and convert into a JSON object
    const rawFormBody = event.body.replace(/^body:\s*'/, '').replace(/'$/, '');
    const body = querystring.parse(rawFormBody);

    const clientTransactionId = body?.trnOrderNumber
    const bookingId = body?.ref1
    const sessionId = body?.ref2

    if (!secret || !bookingId || !sessionId || !clientTransactionId ) {
      throw new Exception("Missing required transaction fields", { code: 400 });
    }
    
    // Protect from any POST requests to endpoint
    if (secret !== WORLDLINE_WEBHOOK_SECRET) {
      throw new Exception("Incorrect webhook secret", { code: 400 });
    }

    const updateRequestsTransaction = await updateTransactionForPayment(clientTransactionId, bookingId, sessionId, body);

    const putItemsTransactions = await quickApiUpdateHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [updateRequestsTransaction],
      TRANSACTION_UPDATE_CONFIG
    );

    const resTransaction = await batchTransactData(putItemsTransactions);

    // TODO: Configure a better setup for retries and/or error handling
    // If the transaction successfully updates to "paid", confirm the booking now
    const updateRequestsBooking = await completeBooking(bookingId, sessionId, clientTransactionId);

    const putItemsBooking = await quickApiUpdateHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [updateRequestsBooking],
      BOOKING_UPDATE_CONFIG
    );

    const resBooking = await batchTransactData(putItemsBooking);

    // Send receipt email after successful payment
    try {
      if (updateRequestsTransaction?.item?.paymentStatus === 'paid' && updateRequestsBooking?.item) {
        await sendReceiptEmailNotification(updateRequestsBooking.item, body);
        logger.info('Receipt email queued successfully', { bookingId });
      }
    } catch (emailError) {
      // Log email error but don't fail the main transaction
      logger.error('Failed to queue receipt email', {
        bookingId,
        error: emailError.message
      });
    }

    const response = {
      res: resBooking,
      transaction: updateRequestsTransaction,
      booking: updateRequestsBooking,
    }

    return sendResponse(
      200,
      { response },
      "Success",
      null,
      context
    );
    
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || error?.msg || "Error",
      error?.error || String(error),
      context
    );
  }
};

/**
 * Send receipt email notification after successful payment
 * @param {Object} bookingItem - Booking data from DynamoDB
 * @param {Object} paymentData - Payment data from Worldline
 */
async function sendReceiptEmailNotification(bookingItem, paymentData) {
  try {
    // Extract data from booking item
    const bookingData = {
      bookingId: bookingItem.pk || bookingItem.bookingId,
      bookingReference: bookingItem.bookingReference || bookingItem.pk,
      orderNumber: paymentData.trnOrderNumber,
      orderDate: paymentData.trnDate || new Date().toISOString(),
      startDate: bookingItem.startDate,
      endDate: bookingItem.endDate,
      numberOfNights: bookingItem.numberOfNights || 1,
      numberOfGuests: bookingItem.numberOfGuests || 1,
      status: 'confirmed'
    };

    // Extract location data
    const locationData = {
      parkName: bookingItem.parkName || 'BC Parks',
      facilityName: bookingItem.facilityName,
      siteNumber: bookingItem.siteNumber,
      region: bookingItem.region || 'default',
      address: bookingItem.address
    };

    // Extract customer data
    const customerData = {
      firstName: bookingItem.firstName || paymentData.customerFirstName,
      lastName: bookingItem.lastName || paymentData.customerLastName,
      email: bookingItem.email || paymentData.customerEmail,
      phone: bookingItem.phone || paymentData.customerPhone,
      address: {
        street: paymentData.billingStreet,
        city: paymentData.billingCity,
        province: paymentData.billingProvince,
        postalCode: paymentData.billingPostalCode,
        country: paymentData.billingCountry
      }
    };

    // Extract payment data
    const paymentProcessedData = {
      totalAmount: parseInt(paymentData.trnAmount) || bookingItem.totalAmount,
      currency: 'CAD',
      transactionId: paymentData.trnId,
      paymentMethod: paymentData.paymentMethod || 'Credit Card',
      itemBreakdown: bookingItem.itemBreakdown || [
        {
          description: 'Reservation Fee',
          amount: parseInt(paymentData.trnAmount) || bookingItem.totalAmount
        }
      ]
    };

    // Get region-specific branding
    const brandingData = getRegionBranding(locationData);

    // Send receipt email
    await sendReceiptEmail({
      bookingData,
      customerData,
      paymentData: paymentProcessedData,
      locationData,
      brandingData,
      locale: bookingItem.locale || 'en'
    });

    logger.info('Receipt email sent successfully', {
      bookingId: bookingData.bookingId,
      recipient: customerData.email
    });

  } catch (error) {
    logger.error('Failed to send receipt email', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}
