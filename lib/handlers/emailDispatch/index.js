/**
 * Email Dispatch Lambda Handler
 * Processes SQS messages and sends emails via AWS SES using Handlebars templates
 */

const { logger, Exception } = require("/opt/base");
const { validateEmailPayload } = require('./schema');
const { TemplateEngine } = require('./templateEngine');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const SES_REGION = process.env.SES_REGION || 'ca-central-1';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@bcparks.ca';
const TEMPLATE_BUCKET_NAME = process.env.TEMPLATE_BUCKET_NAME;

// Initialize SES client
const sesClient = new SESClient({ region: SES_REGION });

/**
 * Main Lambda handler for email dispatch
 * @param {Object} event - SQS event containing email dispatch messages
 * @param {Object} context - Lambda context
 */
exports.handler = async (event, context) => {
  logger.info('Email Dispatch Handler started', { 
    recordCount: event.Records?.length || 0,
    context: context.awsRequestId 
  });

  const results = [];

  try {
    // Process each SQS message
    for (const record of event.Records) {
      try {
        const result = await processEmailMessage(record);
        results.push({ success: true, messageId: record.messageId, result });
        logger.info('Email sent successfully', { messageId: record.messageId });
      } catch (error) {
        logger.error('Failed to process email message', {
          messageId: record.messageId,
          error: error.message,
          stack: error.stack
        });
        results.push({ 
          success: false, 
          messageId: record.messageId, 
          error: error.message 
        });
        
        // Re-throw error to trigger SQS retry/DLQ behavior
        throw error;
      }
    }

    logger.info('Email dispatch completed', { 
      totalProcessed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Email dispatch completed',
        results
      })
    };

  } catch (error) {
    logger.error('Email dispatch handler failed', {
      error: error.message,
      stack: error.stack
    });
    
    throw error; // Let SQS handle retry logic
  }
};

/**
 * Process a single email message from SQS
 * @param {Object} record - SQS record
 * @returns {Object} Processing result
 */
async function processEmailMessage(record) {
  logger.info('Processing email message', { messageId: record.messageId });

  // Parse the SQS message body
  let payload;
  try {
    payload = JSON.parse(record.body);
  } catch (error) {
    throw new Exception('Invalid JSON in SQS message body', { 
      code: 400,
      messageId: record.messageId 
    });
  }

  // Validate the payload
  const validation = validateEmailPayload(payload);
  if (!validation.isValid) {
    throw new Exception('Invalid email payload', {
      code: 400,
      errors: validation.errors,
      messageId: record.messageId
    });
  }

  // Initialize template engine
  const templateEngine = new TemplateEngine({
    templateBucket: TEMPLATE_BUCKET_NAME,
    locale: payload.locale
  });

  // Load and compile templates
  const templates = await templateEngine.loadTemplate(payload.templateName);
  if (!templates) {
    throw new Exception('Template not found', {
      code: 404,
      templateName: payload.templateName
    });
  }

  // Render the email content
  const emailContent = await templateEngine.renderTemplate(
    templates,
    payload.templateData
  );

  // Send the email via SES
  const emailResult = await sendEmail({
    to: payload.recipientEmail,
    toName: payload.recipientName,
    subject: payload.subject,
    htmlContent: emailContent.html,
    textContent: emailContent.text,
    metadata: payload.metadata
  });

  return {
    emailId: emailResult.MessageId,
    templateName: payload.templateName,
    recipient: payload.recipientEmail,
    subject: payload.subject
  };
}

/**
 * Send email via AWS SES
 * @param {Object} params - Email parameters
 * @returns {Object} SES response
 */
async function sendEmail(params) {
  const { to, toName, subject, htmlContent, textContent, metadata = {} } = params;

  const emailParams = {
    Source: SES_FROM_EMAIL,
    Destination: {
      ToAddresses: [toName ? `${toName} <${to}>` : to],
    },
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
      Body: {
        Html: {
          Data: htmlContent,
          Charset: 'UTF-8',
        },
        Text: {
          Data: textContent,
          Charset: 'UTF-8',
        },
      },
    },
    // Add metadata as email headers for tracking
    Tags: [
      {
        Name: 'Source',
        Value: 'ReserveRecAPI',
      },
      {
        Name: 'MessageType',
        Value: metadata.messageType || 'unknown',
      },
      {
        Name: 'BookingId',
        Value: metadata.bookingId || 'unknown',
      }
    ]
  };

  try {
    const command = new SendEmailCommand(emailParams);
    const result = await sesClient.send(command);
    
    logger.info('Email sent via SES', {
      messageId: result.MessageId,
      recipient: to,
      subject: subject
    });

    return result;
  } catch (error) {
    logger.error('SES send email failed', {
      error: error.message,
      recipient: to,
      subject: subject
    });
    throw new Exception('Failed to send email via SES', {
      code: 500,
      originalError: error.message
    });
  }
}