/**
 * AWS SES utilities for sending emails
 */

const { SESClient, SendEmailCommand, SendRawEmailCommand, GetSendQuotaCommand } = require('@aws-sdk/client-ses');
const { logger } = require('/opt/base');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const sesClient = new SESClient({ region: AWS_REGION });

/**
 * Send a simple email via SES
 * @param {Object} params - Email parameters
 * @returns {Promise<Object>} SES response
 */
async function sendEmail(params) {
  const {
    source,
    destination,
    subject,
    htmlBody,
    textBody,
    replyToAddresses = [],
    tags = []
  } = params;

  const emailParams = {
    Source: source,
    Destination: destination,
    Message: {
      Subject: {
        Data: subject,
        Charset: 'UTF-8',
      },
      Body: {
        ...(htmlBody && {
          Html: {
            Data: htmlBody,
            Charset: 'UTF-8',
          }
        }),
        ...(textBody && {
          Text: {
            Data: textBody,
            Charset: 'UTF-8',
          }
        })
      },
    },
    ...(replyToAddresses.length > 0 && { ReplyToAddresses: replyToAddresses }),
    ...(tags.length > 0 && { Tags: tags })
  };

  try {
    const command = new SendEmailCommand(emailParams);
    const result = await sesClient.send(command);
    
    logger.info('Email sent successfully via SES', {
      messageId: result.MessageId,
      destination: destination.ToAddresses
    });

    return result;
  } catch (error) {
    logger.error('Failed to send email via SES', {
      error: error.message,
      destination: destination.ToAddresses
    });
    throw error;
  }
}

/**
 * Send raw email via SES (for advanced formatting, attachments, etc.)
 * @param {Object} params - Raw email parameters
 * @returns {Promise<Object>} SES response
 */
async function sendRawEmail(params) {
  const { source, destinations, rawMessage, tags = [] } = params;

  const rawEmailParams = {
    Source: source,
    Destinations: destinations,
    RawMessage: {
      Data: rawMessage
    },
    ...(tags.length > 0 && { Tags: tags })
  };

  try {
    const command = new SendRawEmailCommand(rawEmailParams);
    const result = await sesClient.send(command);
    
    logger.info('Raw email sent successfully via SES', {
      messageId: result.MessageId,
      destinations
    });

    return result;
  } catch (error) {
    logger.error('Failed to send raw email via SES', {
      error: error.message,
      destinations
    });
    throw error;
  }
}

/**
 * Get SES sending quota and statistics
 * @returns {Promise<Object>} Quota information
 */
async function getSendQuota() {
  try {
    const command = new GetSendQuotaCommand({});
    const result = await sesClient.send(command);
    
    logger.info('Retrieved SES send quota', {
      max24HourSend: result.Max24HourSend,
      maxSendRate: result.MaxSendRate,
      sentLast24Hours: result.SentLast24Hours
    });

    return result;
  } catch (error) {
    logger.error('Failed to get SES send quota', {
      error: error.message
    });
    throw error;
  }
}

/**
 * Format email destination object
 * @param {Object} params - Destination parameters
 * @returns {Object} Formatted destination object
 */
function formatDestination(params) {
  const { to = [], cc = [], bcc = [] } = params;
  
  return {
    ...(to.length > 0 && { ToAddresses: Array.isArray(to) ? to : [to] }),
    ...(cc.length > 0 && { CcAddresses: Array.isArray(cc) ? cc : [cc] }),
    ...(bcc.length > 0 && { BccAddresses: Array.isArray(bcc) ? bcc : [bcc] })
  };
}

/**
 * Create email tags for tracking
 * @param {Object} metadata - Metadata to convert to tags
 * @returns {Array} Array of SES tags
 */
function createEmailTags(metadata = {}) {
  const tags = [];
  
  Object.entries(metadata).forEach(([key, value]) => {
    if (value && typeof value === 'string' && value.length <= 256) {
      tags.push({
        Name: key,
        Value: value
      });
    }
  });

  return tags;
}

module.exports = {
  sendEmail,
  sendRawEmail,
  getSendQuota,
  formatDestination,
  createEmailTags
};