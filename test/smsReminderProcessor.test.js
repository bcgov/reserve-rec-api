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
