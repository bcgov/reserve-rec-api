const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const { logger } = require('/opt/base');

let smsReminderSqsClient;

function createSmsReminderMessageAttributes(attributes = {}) {
  const messageAttributes = {};

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      messageAttributes[key] = {
        DataType: 'String',
        StringValue: String(value),
      };
    }
  });

  return messageAttributes;
}

function getSmsReminderSqsClient(queueUrl) {
  if (smsReminderSqsClient) {
    return smsReminderSqsClient;
  }

  smsReminderSqsClient = new SQSClient({
    region: 'ca-central-1',
  });

  logger.info('SMS reminder SQS client configuration', {
    region: 'ca-central-1',
    queueUrl: queueUrl || null,
  });

  return smsReminderSqsClient;
}

function buildSmsReminderPayload(body, response) {
  return {
    bookingId: response?.bookingId || response?.globalId || null,
    userId: body?.userId || null,
    mobilePhone: body?.namedOccupant?.contactInfo?.mobilePhone || null,
    startDate: body?.startDate || null,
    collectionId: body?.collectionId || null,
    activityType: body?.activityType || null,
    activityId: body?.activityId || null,
    displayName: body?.displayName || null,
    smsOptIn: true,
  };
}

async function enqueueSmsReminderIfNeeded(body, response) {
  if (!body?.smsOptIn) {
    return;
  }

  const smsReminderPayload = buildSmsReminderPayload(body, response);
  const queueUrl = process.env.SMS_REMINDER_QUEUE_URL;

  try {
    if (!queueUrl) {
      logger.info('SMS reminder enqueue skipped: queue URL not configured', {
        bookingId: smsReminderPayload.bookingId,
      });
      return;
    }

    if (!smsReminderPayload.mobilePhone) {
      logger.info('SMS reminder enqueue skipped: mobile phone missing', {
        bookingId: smsReminderPayload.bookingId,
      });
      return;
    }

    const sqsClient = getSmsReminderSqsClient(queueUrl);
    const messageAttributes = createSmsReminderMessageAttributes({
      bookingId: smsReminderPayload.bookingId,
      activityType: smsReminderPayload.activityType,
      startDate: smsReminderPayload.startDate,
    });

    await sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(smsReminderPayload),
      ...(Object.keys(messageAttributes).length > 0 ? { MessageAttributes: messageAttributes } : {}),
    }));

    logger.info('SMS reminder queued', {
      bookingId: smsReminderPayload.bookingId,
      queueUrl,
    });
  } catch (error) {
    logger.warn('SMS reminder enqueue failed', {
      error: error?.message || String(error),
      bookingId: smsReminderPayload.bookingId,
    });
  }
}

module.exports = {
  enqueueSmsReminderIfNeeded,
};