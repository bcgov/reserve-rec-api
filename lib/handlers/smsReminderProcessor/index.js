const {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand,
} = require('@aws-sdk/client-pinpoint-sms-voice-v2');
const { logger } = require('/opt/base');

let smsClient;

function getSmsClient() {
  if (smsClient) {
    return smsClient;
  }

  smsClient = new PinpointSMSVoiceV2Client({
    region: 'ca-central-1',
  });

  logger.info('SMS reminder End User Messaging client configuration', {
    region: 'ca-central-1',
  });

  return smsClient;
}

function parseSmsReminderRecord(record) {
  if (record?.eventSource !== 'aws:sqs') {
    throw new Error(`Unsupported event source: ${record?.eventSource || 'unknown'}`);
  }

  const body = JSON.parse(record.body || '{}');
  return body?.Message ? JSON.parse(body.Message) : body;
}

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return null;
  }

  const trimmedPhoneNumber = String(phoneNumber).trim();
  const digits = trimmedPhoneNumber.replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  if (trimmedPhoneNumber.startsWith('+') && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return null;
}

function buildSmsMessage(payload) {
  if (payload?.messageBody) {
    return payload.messageBody;
  }

  const displayName = payload?.displayName || 'your reservation';
  const startDate = payload?.startDate || 'your upcoming visit';
  const bookingId = payload?.bookingId ? ` Booking ID: ${payload.bookingId}.` : '';

  return `BC Parks: Your booking for ${displayName} on ${startDate} is confirmed.${bookingId}`;
}

function buildSmsContext(payload) {
  return {
    ...(payload?.bookingId ? { bookingId: String(payload.bookingId) } : {}),
    ...(payload?.userId ? { userId: String(payload.userId) } : {}),
    ...(payload?.activityType ? { activityType: String(payload.activityType) } : {}),
    ...(payload?.activityId ? { activityId: String(payload.activityId) } : {}),
    ...(payload?.collectionId ? { collectionId: String(payload.collectionId) } : {}),
  };
}

const optionalRequestFields = [
  {
    payloadKey: 'originationIdentity',
    envKey: 'SMS_ORIGINATION_IDENTITY',
    requestKey: 'OriginationIdentity',
  },
  {
    payloadKey: 'configurationSetName',
    envKey: 'SMS_CONFIGURATION_SET_NAME',
    requestKey: 'ConfigurationSetName',
  },
  {
    payloadKey: 'protectConfigurationId',
    envKey: 'SMS_PROTECT_CONFIGURATION_ID',
    requestKey: 'ProtectConfigurationId',
  },
  {
    payloadKey: 'keyword',
    envKey: 'SMS_KEYWORD',
    requestKey: 'Keyword',
  },
  {
    payloadKey: 'maxPrice',
    envKey: 'SMS_MAX_PRICE',
    requestKey: 'MaxPrice',
    transform: String,
  },
];

function assignOptionalRequestFields(request, payload) {
  optionalRequestFields.forEach(({ payloadKey, envKey, requestKey, transform = (value) => value }) => {
    const value = payload?.[payloadKey] || process.env[envKey];

    if (value) {
      request[requestKey] = transform(value);
    }
  });
}

function buildSmsRequest(payload, phoneNumber) {
  const request = {
    DestinationPhoneNumber: phoneNumber,
    MessageBody: buildSmsMessage(payload),
    MessageType: String(payload?.messageType || process.env.SMS_MESSAGE_TYPE || 'TRANSACTIONAL').toUpperCase(),
  };

  assignOptionalRequestFields(request, payload);

  if (payload?.timeToLive != null) {
    request.TimeToLive = Number(payload.timeToLive);
  }

  if (payload?.messageFeedbackEnabled != null) {
    request.MessageFeedbackEnabled = Boolean(payload.messageFeedbackEnabled);
  }

  if (payload?.dryRun != null) {
    request.DryRun = Boolean(payload.dryRun);
  }

  const context = payload?.context || buildSmsContext(payload);
  if (context && Object.keys(context).length > 0) {
    request.Context = context;
  }

  return request;
}

exports.handler = async (event) => {
  const records = event?.Records || [];
  logger.info('SMS reminder processor invoked', {
    recordCount: records.length,
  });

  const client = getSmsClient();

  for (const record of records) {
    const payload = parseSmsReminderRecord(record);
    const phoneNumber = normalizePhoneNumber(payload?.mobilePhone);

    if (!phoneNumber) {
      logger.warn('Skipping SMS reminder: invalid phone number', {
        bookingId: payload?.bookingId || null,
        mobilePhone: payload?.mobilePhone || null,
      });
      continue;
    }

    const request = buildSmsRequest(payload, phoneNumber);
    const command = new SendTextMessageCommand(request);

    const result = await client.send(command);
    logger.info('SMS reminder sent', {
      bookingId: payload?.bookingId || null,
      phoneNumber,
      messageId: result?.MessageId || null,
      messageType: request.MessageType,
      configurationSetName: request.ConfigurationSetName || null,
      originationIdentity: request.OriginationIdentity || null,
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'SMS reminders processed',
      recordCount: records.length,
    }),
  };
};