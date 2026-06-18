// Unit tests for the booking confirmation SMS enqueue. Issue #570: the SMS
// opt-in and Cognito-resolved phone only exist once a booking is completed,
// so the enqueue must run at the complete step. These tests pin the dispatch
// gate (opt-in + phone) and the request-vs-fallback phone resolution.

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({ MessageId: 'msg-1' }) })),
  SendMessageCommand: jest.fn((params) => ({ params })),
}));

const { SendMessageCommand } = require('@aws-sdk/client-sqs');
const { enqueueSmsReminderIfNeeded } = require('../../src/handlers/bookings/notifications');

const QUEUE_URL = 'https://sqs.ca-central-1.amazonaws.com/123456789012/sms-reminder';

describe('enqueueSmsReminderIfNeeded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMS_REMINDER_QUEUE_URL = QUEUE_URL;
  });

  const baseBody = {
    smsOptIn: true,
    namedOccupant: { contactInfo: { mobilePhone: '7787000371' } },
    startDate: '2026-06-18',
    activityType: 'dayuse',
    displayName: 'Joffre Lakes Day-use Pass - All day, 2026-06-18',
  };

  it('does not enqueue when smsOptIn is false', async () => {
    await enqueueSmsReminderIfNeeded({ ...baseBody, smsOptIn: false }, { bookingId: 'b1' });
    expect(SendMessageCommand).not.toHaveBeenCalled();
  });

  it('does not enqueue when no mobile phone is available', async () => {
    const noPhone = { ...baseBody, namedOccupant: { contactInfo: {} } };
    await enqueueSmsReminderIfNeeded(noPhone, { bookingId: 'b1' }, null);
    expect(SendMessageCommand).not.toHaveBeenCalled();
  });

  it('enqueues an SMS with the booking id and phone when opted in', async () => {
    await enqueueSmsReminderIfNeeded(baseBody, { bookingId: 'b-123' });
    expect(SendMessageCommand).toHaveBeenCalledTimes(1);
    const { QueueUrl, MessageBody } = SendMessageCommand.mock.calls[0][0];
    expect(QueueUrl).toBe(QUEUE_URL);
    const payload = JSON.parse(MessageBody);
    expect(payload.bookingId).toBe('b-123');
    expect(payload.mobilePhone).toBe('7787000371');
    expect(payload.smsOptIn).toBe(true);
  });

  it('falls back to the resolved phone when the body omits one', async () => {
    const noBodyPhone = { ...baseBody, namedOccupant: { contactInfo: {} } };
    await enqueueSmsReminderIfNeeded(noBodyPhone, { bookingId: 'b-9' }, '7780001111');
    expect(SendMessageCommand).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(SendMessageCommand.mock.calls[0][0].MessageBody);
    expect(payload.mobilePhone).toBe('7780001111');
  });

  it('skips quietly when the queue URL is not configured', async () => {
    delete process.env.SMS_REMINDER_QUEUE_URL;
    await enqueueSmsReminderIfNeeded(baseBody, { bookingId: 'b1' });
    expect(SendMessageCommand).not.toHaveBeenCalled();
  });
});
