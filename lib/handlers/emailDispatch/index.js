/**
 * Email Dispatch Lambda Handler
 * Processes SQS messages and sends emails via AWS SES using Handlebars templates
 */

const { logger, Exception } = require("/opt/base");
const { validateEmailPayload } = require('./schema');
const { TemplateEngine } = require('./templateEngine');
const { SESClient, SendRawEmailCommand } = require('@aws-sdk/client-ses');
const MailComposer = require('nodemailer/lib/mail-composer');
const { generateQRURL, generateQRCodeBuffer } = require('./qrCodeHelper');
const { redactEmail } = require('./utils');
const fs = require('fs');
const path = require('path');

// Content-ID used to reference the inline QR code from the HTML template
// (<img src="cid:booking-qr">). Email clients strip `data:` URIs, so the QR
// must be delivered as a real MIME attachment referenced by this id.
const QR_CONTENT_ID = 'booking-qr';

// Brand images ride the same CID mechanism as the QR code: clients strip
// `data:` URIs, and hosting them would add a CDN the email does not otherwise
// depend on. Loaded once at cold start from the bundled assets folder (#731).
const BRAND_ASSETS = [
  { cid: 'bcparks-logo', file: 'bcparks-logo.png', key: 'logoCid' },
  { cid: 'icon-pin', file: 'icon-pin.png', key: 'pinCid' },
  { cid: 'icon-ticket', file: 'icon-ticket.png', key: 'ticketCid' },
];

const brandImages = loadBrandImages();

/**
 * Read the bundled brand PNGs. A missing file is logged and skipped rather
 * than thrown: the template guards every image on its Content-ID, so the email
 * still sends, just without that image.
 */
function loadBrandImages() {
  const loaded = [];
  for (const asset of BRAND_ASSETS) {
    try {
      loaded.push({
        ...asset,
        content: fs.readFileSync(path.join(__dirname, 'assets', asset.file)),
      });
    } catch (error) {
      logger.error('Brand image missing from the bundle', {
        file: asset.file,
        error: error.message,
      });
    }
  }
  return loaded;
}

const SES_REGION = process.env.SES_REGION || 'ca-central-1';
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL || 'noreply@bcparks.ca';
const TEMPLATE_BUCKET_NAME = process.env.TEMPLATE_BUCKET_NAME;
const INCLUDE_QR_INLINE = process.env.INCLUDE_QR_INLINE === 'true';

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

  // Pre-generate QR code if enabled and booking data is present.
  // The QR is delivered as a CID inline attachment (not a data: URI) so it
  // renders in Gmail and other clients that strip data URIs. We generate the
  // PNG bytes here and expose `qrCid` to the template; the buffer is attached
  // to the MIME message in sendEmail().
  let qrCodeBuffer = null;
  if (INCLUDE_QR_INLINE && payload.templateData?.booking?.bookingId) {
    try {
      const bookingId = payload.templateData.booking.bookingId;
      const verificationUrl = generateQRURL(bookingId);
      qrCodeBuffer = await generateQRCodeBuffer(verificationUrl);

      // Expose the Content-ID so the template can reference the inline image.
      payload.templateData.booking.qrCid = QR_CONTENT_ID;
      payload.templateData.booking.qrVerificationUrl = verificationUrl;

      logger.debug('QR code generated for email', {
        bookingId,
        hasQRCode: true
      });
    } catch (error) {
      // Log error but don't fail email send - QR code is optional
      logger.error('Failed to generate QR code for email', {
        bookingId: payload.templateData.booking.bookingId,
        error: error.message
      });
      // Continue without QR code
    }
  }

  // Expose each loaded image's Content-ID so the template can reference it.
  // Only ids that actually loaded are set, so `{{#if branding.logoCid}}` is a
  // real guard rather than decoration.
  payload.templateData = payload.templateData || {};
  payload.templateData.branding = {
    ...(payload.templateData.branding || {}),
    ...Object.fromEntries(brandImages.map(({ key, cid }) => [key, cid])),
  };

  // Render the email content
  const emailContent = await templateEngine.renderTemplate(
    templates,
    payload.templateData
  );

  // Attach the QR PNG inline (referenced from the HTML by Content-ID) when present.
  const attachments = qrCodeBuffer
    ? [{
        filename: 'booking-qr.png',
        content: qrCodeBuffer,
        contentType: 'image/png',
        cid: QR_CONTENT_ID,
        contentDisposition: 'inline',
      }]
    : [];

  attachments.push(...brandImages.map(({ file, content, cid }) => ({
    filename: file,
    content,
    contentType: 'image/png',
    cid,
    contentDisposition: 'inline',
  })));

  // Send the email via SES
  const emailResult = await sendEmail({
    to: payload.recipientEmail,
    toName: payload.recipientName,
    subject: payload.subject,
    htmlContent: emailContent.html,
    textContent: emailContent.text,
    attachments,
    metadata: payload.metadata
  });

  return {
    emailId: emailResult.MessageId,
    templateName: payload.templateName,
    recipientDomain: redactEmail(payload.recipientEmail),
    subject: payload.subject,
  };
}

/**
 * Send email via AWS SES using a raw MIME message.
 *
 * We build the MIME with nodemailer's MailComposer and send via
 * SendRawEmailCommand (rather than SendEmailCommand) so the QR code can be
 * embedded as a CID inline attachment — clients like Gmail strip `data:` URIs,
 * so an attachment referenced by Content-ID is the only reliable way to render
 * it. MailComposer also handles correct quoted-printable/base64 encoding of
 * non-ASCII content (e.g. park names like "Mʔuqʷin/Brooks Peninsula Park").
 *
 * @param {Object} params - Email parameters
 * @returns {Object} SES response
 */
async function sendEmail(params) {
  const { to, toName, subject, htmlContent, textContent, attachments = [], metadata = {} } = params;

  try {
    const mail = new MailComposer({
      from: SES_FROM_EMAIL,
      to: toName ? `${toName} <${to}>` : to,
      subject,
      text: textContent,
      html: htmlContent,
      attachments,
      // Mirror the previous SES message tags as custom headers for tracking.
      headers: {
        'X-RR-Source': 'ReserveRecAPI',
        'X-RR-MessageType': metadata.messageType || 'unknown',
        'X-RR-BookingId': metadata.bookingId || 'unknown',
      },
    });

    const rawMessage = await new Promise((resolve, reject) => {
      mail.compile().build((err, message) => (err ? reject(err) : resolve(message)));
    });

    const command = new SendRawEmailCommand({
      Source: SES_FROM_EMAIL,
      Destinations: [toName ? `${toName} <${to}>` : to],
      RawMessage: { Data: rawMessage },
    });
    const result = await sesClient.send(command);

    logger.info('Email sent via SES', {
      messageId: result.MessageId,
      bookingId: metadata.bookingId,
      recipientDomain: redactEmail(to),
      subject: subject,
      hasAttachments: attachments.length > 0
    });

    return result;
  } catch (error) {
    logger.error('SES send email failed', {
      error: error.message,
      bookingId: metadata.bookingId,
      recipientDomain: redactEmail(to),
      subject: subject
    });
    throw new Exception('Failed to send email via SES', {
      code: 500,
      originalError: error.message
    });
  }
}