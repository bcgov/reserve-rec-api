const mockSqsSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn().mockImplementation((input) => ({ input })),
}));
jest.mock('/opt/base', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
  Exception: class Exception extends Error {
    constructor(message, options = {}) {
      super(message);
      this.code = options.code;
      this.data = options;
    }
  },
}));

process.env.EMAIL_QUEUE_URL = 'https://sqs.ca-central-1.amazonaws.com/123456789012/email';
const { sendMigrationConfirmationEmail } = require('../lib/handlers/emailDispatch/utils');

describe('migration confirmation email utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSqsSend.mockResolvedValue({ MessageId: 'message-id' });
  });

  it('queues a valid migration email with a usable recipient name', async () => {
    await sendMigrationConfirmationEmail({
      recipientEmail: 'parks@example.test',
      recipientName: '',
      confirmationUrl: 'https://reserve.example.test/migration-confirm#migrateId=id&token=token',
      migrateId: 'migration-id',
    });

    const queuedMessage = JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody);
    expect(queuedMessage).toMatchObject({
      messageType: 'migration',
      templateName: 'migration_bcparks_default',
      recipientEmail: 'parks@example.test',
      recipientName: 'BC Parks account holder',
      templateData: {
        confirmationUrl: 'https://reserve.example.test/migration-confirm#migrateId=id&token=token',
      },
      metadata: { migrateId: 'migration-id' },
    });
  });
});
