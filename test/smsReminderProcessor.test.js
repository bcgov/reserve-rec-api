jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-pinpoint-sms-voice-v2', () => ({
  PinpointSMSVoiceV2Client: jest.fn(() => ({ send: mockSend })),
  SendTextMessageCommand: jest.fn((input) => ({ input })),
}));

const { handler } = require('../lib/handlers/smsReminderProcessor');
const { logger } = require('/opt/base');

const record = (overrides = {}) => ({
  eventSource: 'aws:sqs',
  body: JSON.stringify({ bookingId: 'b1', mobilePhone: '2505550100', displayName: 'Joffre', startDate: '2026-09-18', ...overrides }),
});

const sdkError = (name) => Object.assign(new Error(`${name} raised`), { name });

beforeEach(() => {
  mockSend.mockReset();
  logger.error.mockClear();
  logger.info.mockClear();
  delete process.env.SMS_SKIP_COUNTRIES;
});

describe('smsReminderProcessor error handling', () => {
  test('sends a normalised number and reports the message id', async () => {
    mockSend.mockResolvedValue({ MessageId: 'm1' });
    const res = await handler({ Records: [record()] });
    expect(mockSend.mock.calls[0][0].input.DestinationPhoneNumber).toBe('+12505550100');
    expect(res.statusCode).toBe(200);
  });

  test.each(['ConflictException', 'ValidationException', 'AccessDeniedException', 'ResourceNotFoundException'])(
    'drops the message on %s instead of throwing', async (name) => {
      mockSend.mockRejectedValue(sdkError(name));
      await expect(handler({ Records: [record()] })).resolves.toMatchObject({ statusCode: 200 });
      expect(logger.error).toHaveBeenCalledWith(
        'SMS reminder dropped: non-retryable error',
        expect.objectContaining({ bookingId: 'b1', errorName: name }),
      );
    },
  );

  test.each(['ThrottlingException', 'InternalServerException', 'ServiceQuotaExceededException'])(
    'rethrows %s so SQS retries it', async (name) => {
      mockSend.mockRejectedValue(sdkError(name));
      await expect(handler({ Records: [record()] })).rejects.toThrow(`${name} raised`);
    },
  );

  test('a dropped message does not stop later records in the batch', async () => {
    mockSend.mockRejectedValueOnce(sdkError('ConflictException')).mockResolvedValueOnce({ MessageId: 'm2' });
    await handler({ Records: [record({ bookingId: 'b1' }), record({ bookingId: 'b2' })] });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });
});

describe('smsReminderProcessor destination countries', () => {
  beforeEach(() => {
    process.env.SMS_SKIP_COUNTRIES = 'US, GB,cn';
    mockSend.mockResolvedValue({ MessageId: 'm1' });
  });

  test.each([
    ['US', '+12125550123'],
    ['GB', '+447400123456'],
    ['CN', '+8613812345678'],
  ])('skips a %s number without calling AWS', async (country, mobilePhone) => {
    await expect(handler({ Records: [record({ mobilePhone })] })).resolves.toMatchObject({ statusCode: 200 });
    expect(mockSend).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'SMS reminder skipped: no sender for destination country',
      { bookingId: 'b1', country },
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('still sends to a Canadian number', async () => {
    await handler({ Records: [record()] });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('sends to every country when no skip list is set', async () => {
    delete process.env.SMS_SKIP_COUNTRIES;
    await handler({ Records: [record({ mobilePhone: '+12125550123' })] });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});
