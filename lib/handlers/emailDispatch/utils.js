/**
 * SQS utility for sending email dispatch messages
 */

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { logger, Exception } = require("/opt/base");
const { createEmailPayload, validateEmailPayload } = require('./schema');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const EMAIL_QUEUE_URL = process.env.EMAIL_QUEUE_URL;

const sqsClient = new SQSClient({ region: AWS_REGION });

/**
 * Send receipt email to SQS queue for processing
 * @param {Object} params - Receipt email parameters
 * @returns {Promise<Object>} SQS response
 */
async function sendReceiptEmail(params) {
  const {
    bookingData,
    customerData,
    paymentData,
    locationData,
    brandingData,
    locale = 'en'
  } = params;

  // Determine template name based on region
  const region = locationData.region?.toLowerCase().replace(/\s+/g, '') || 'default';
  const templateName = `receipt_bcparks_${region}`;

  // Create email payload
  const emailPayload = createEmailPayload({
    messageType: 'receipt',
    templateName: templateName,
    recipientEmail: customerData.email,
    recipientName: `${customerData.firstName} ${customerData.lastName}`,
    subject: `Booking Receipt - ${locationData.parkName}`,
    locale: locale,
    templateData: {
      booking: bookingData,
      customer: customerData,
      payment: paymentData,
      location: locationData,
      branding: brandingData
    },
    metadata: {
      messageType: 'receipt',
      bookingId: bookingData.bookingId,
      orderNumber: bookingData.orderNumber,
      region: region
    }
  });

  return sendEmailMessage(emailPayload);
}

/**
 * Send confirmation email to SQS queue for processing
 * @param {Object} params - Confirmation email parameters
 * @returns {Promise<Object>} SQS response
 */
async function sendConfirmationEmail(params) {
  const {
    bookingData,
    customerData,
    locationData,
    brandingData,
    locale = 'en'
  } = params;

  const region = locationData.region?.toLowerCase().replace(/\s+/g, '') || 'default';
  const templateName = `confirmation_bcparks_${region}`;

  const emailPayload = createEmailPayload({
    messageType: 'confirmation',
    templateName: templateName,
    recipientEmail: customerData.email,
    recipientName: `${customerData.firstName} ${customerData.lastName}`,
    subject: `Booking Confirmation - ${locationData.parkName}`,
    locale: locale,
    templateData: {
      booking: bookingData,
      customer: customerData,
      location: locationData,
      branding: brandingData
    },
    metadata: {
      messageType: 'confirmation',
      bookingId: bookingData.bookingId,
      region: region
    }
  });

  return sendEmailMessage(emailPayload);
}

/**
 * Send cancellation email to SQS queue for processing
 * @param {Object} params - Cancellation email parameters
 * @returns {Promise<Object>} SQS response
 */
async function sendCancellationEmail(params) {
  const {
    bookingData,
    customerData,
    locationData,
    brandingData,
    refundData,
    locale = 'en'
  } = params;

  const region = locationData.region?.toLowerCase().replace(/\s+/g, '') || 'default';
  const templateName = `cancellation_bcparks_${region}`;

  const emailPayload = createEmailPayload({
    messageType: 'cancellation',
    templateName: templateName,
    recipientEmail: customerData.email,
    recipientName: `${customerData.firstName} ${customerData.lastName}`,
    subject: `Booking Cancellation - ${locationData.parkName}`,
    locale: locale,
    templateData: {
      booking: bookingData,
      customer: customerData,
      location: locationData,
      branding: brandingData,
      refund: refundData
    },
    metadata: {
      messageType: 'cancellation',
      bookingId: bookingData.bookingId,
      region: region
    }
  });

  return sendEmailMessage(emailPayload);
}

/**
 * Send email message to SQS queue
 * @param {Object} payload - Email payload
 * @returns {Promise<Object>} SQS response
 */
async function sendEmailMessage(payload) {
  if (!EMAIL_QUEUE_URL) {
    throw new Exception('EMAIL_QUEUE_URL environment variable not set', {
      code: 500
    });
  }

  // Validate payload
  const validation = validateEmailPayload(payload);
  if (!validation.isValid) {
    throw new Exception('Invalid email payload', {
      code: 400,
      errors: validation.errors
    });
  }

  try {
    const command = new SendMessageCommand({
      QueueUrl: EMAIL_QUEUE_URL,
      MessageBody: JSON.stringify(payload),
      MessageAttributes: {
        messageType: {
          DataType: 'String',
          StringValue: payload.messageType
        },
        templateName: {
          DataType: 'String',
          StringValue: payload.templateName
        },
        locale: {
          DataType: 'String',
          StringValue: payload.locale
        },
        bookingId: {
          DataType: 'String',
          StringValue: payload.metadata?.bookingId || 'unknown'
        }
      },
      // Add delay for immediate processing vs batched processing
      DelaySeconds: 0
    });

    const result = await sqsClient.send(command);
    
    logger.info('Email message sent to SQS', {
      messageId: result.MessageId,
      messageType: payload.messageType,
      templateName: payload.templateName,
      recipient: payload.recipientEmail
    });

    return {
      messageId: result.MessageId,
      messageType: payload.messageType,
      templateName: payload.templateName,
      recipient: payload.recipientEmail
    };

  } catch (error) {
    logger.error('Failed to send email message to SQS', {
      error: error.message,
      messageType: payload.messageType,
      templateName: payload.templateName,
      recipient: payload.recipientEmail
    });

    throw new Exception('Failed to queue email message', {
      code: 500,
      originalError: error.message
    });
  }
}

/**
 * Extract region branding data based on location
 * @param {Object} location - Location data
 * @returns {Object} Branding configuration
 */
function getRegionBranding(location) {
  const region = location.region?.toLowerCase().replace(/\s+/g, '') || 'default';
  
  const brandingConfig = {
    kootenay: {
      primaryColor: '#2c5530',
      logoUrl: 'https://bcparks.ca/assets/logos/kootenay-logo.png',
      contactEmail: 'kootenay.info@gov.bc.ca',
      contactPhone: '1-800-KOOTENAY',
      websiteUrl: 'https://bcparks.ca/explore/regions/kootenay'
    },
    vancouverisland: {
      primaryColor: '#1a4480',
      logoUrl: 'https://bcparks.ca/assets/logos/vi-logo.png',
      contactEmail: 'vancouverisland.info@gov.bc.ca',
      contactPhone: '1-800-VI-PARKS',
      websiteUrl: 'https://bcparks.ca/explore/regions/vancouver-island'
    },
    mainland: {
      primaryColor: '#8b4513',
      logoUrl: 'https://bcparks.ca/assets/logos/mainland-logo.png',
      contactEmail: 'mainland.info@gov.bc.ca',
      contactPhone: '1-800-MAINLAND',
      websiteUrl: 'https://bcparks.ca/explore/regions/mainland'
    },
    northern: {
      primaryColor: '#2f4f4f',
      logoUrl: 'https://bcparks.ca/assets/logos/northern-logo.png',
      contactEmail: 'northern.info@gov.bc.ca',
      contactPhone: '1-800-NORTHERN',
      websiteUrl: 'https://bcparks.ca/explore/regions/northern'
    },
    default: {
      primaryColor: '#003366',
      logoUrl: 'https://bcparks.ca/assets/logos/bcparks-logo.png',
      contactEmail: 'info@bcparks.ca',
      contactPhone: '1-800-BC-PARKS',
      websiteUrl: 'https://bcparks.ca'
    }
  };

  return brandingConfig[region] || brandingConfig.default;
}

module.exports = {
  sendReceiptEmail,
  sendConfirmationEmail,
  sendCancellationEmail,
  sendEmailMessage,
  getRegionBranding
};