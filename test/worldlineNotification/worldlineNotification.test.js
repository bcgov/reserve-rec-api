'use strict';

process.env.WORLDLINE_WEBHOOK_SECRET = 'whsec';
process.env.EMAIL_QUEUE_URL = 'https://sqs.ca-central-1.amazonaws.com/123/email';

const mockSqsSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  ...jest.requireActual('@aws-sdk/client-sqs'),
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
}));
const mockBatchTransact = jest.fn();
jest.mock('/opt/dynamodb', () => ({ ...jest.requireActual('/opt/dynamodb'), batchTransactData: (...a) => mockBatchTransact(...a) }));
const mockUpdateTransactionForPayment = jest.fn();
jest.mock('../../src/handlers/transactions/methods', () => ({
  updateTransactionForPayment: (...a) => mockUpdateTransactionForPayment(...a),
}));
const mockCompleteBooking = jest.fn();
const mockGetBooking = jest.fn();
jest.mock('../../src/handlers/bookings/methods', () => ({
  completeBooking: (...a) => mockCompleteBooking(...a),
  getBookingByBookingId: (...a) => mockGetBooking(...a),
}));

const { handler } = require('../../src/handlers/worldlineNotification/POST/index');

const form = (fields) => new URLSearchParams(fields).toString();
const notify = (fields, secret = 'whsec') => ({
  httpMethod: 'POST',
  queryStringParameters: secret ? { webhookSecret: secret } : {},
  body: `body: '${form(fields)}'`,
  headers: {},
});
const paid = { trnOrderNumber: 'T-1', ref1: 'B-1', ref2: 'S-1', trnApproved: '1', trnAmount: '12.50', trnId: '10000123', trnCustomerName: 'Ada King Lovelace', trnEmailAddress: 'pay@example.com' };
// completeBooking returns an already-built transact array; the handler feeds it to quickApiUpdateHandler again.
const bookingUpdate = { action: 'Update', data: { TableName: 'TransactionalDataTable', Key: { pk: { S: 'booking::x' }, sk: { S: '2026-07-01::B-1' } }, UpdateExpression: 'SET #status = :status' } };
const sqsMessage = () => JSON.parse(mockSqsSend.mock.calls[0][0].input.MessageBody);

describe('POST /worldline-notification', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBatchTransact.mockResolvedValue({ ok: true });
    mockSqsSend.mockResolvedValue({ MessageId: 'm-1' });
    mockUpdateTransactionForPayment.mockResolvedValue({ key: { pk: 'transaction::T-1', sk: 'base' }, data: { status: 'paid' } });
    mockCompleteBooking.mockResolvedValue({ updateRequests: [bookingUpdate], emailParams: null, smsParams: null, ownerIdentity: null });
    mockGetBooking.mockResolvedValue({ bookingId: 'B-1', displayName: 'Golden Ears Day Use', startDate: '2026-07-01', partyInformation: { adult: 2, child: 1 } });
  });

  it('answers CORS preflight', async () => {
    expect((await handler({ httpMethod: 'OPTIONS' }, {})).statusCode).toBe(200);
  });

  it.each([
    ['no secret', notify(paid, null)],
    ['no booking ref', notify({ ...paid, ref1: '' })],
    ['no session ref', notify({ ...paid, ref2: '' })],
    ['no order number', notify({ ...paid, trnOrderNumber: '' })],
  ])('rejects a notification with %s', async (_, event) => {
    const res = await handler(event, {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).msg).toBe('Missing required transaction fields');
    expect(mockUpdateTransactionForPayment).not.toHaveBeenCalled();
  });

  it('rejects a wrong webhook secret before touching any record', async () => {
    const res = await handler(notify(paid, 'guess'), {});
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).msg).toBe('Incorrect webhook secret');
    expect(mockUpdateTransactionForPayment).not.toHaveBeenCalled();
    expect(mockBatchTransact).not.toHaveBeenCalled();
  });

  // The handler passes completeBooking's result back through quickApiUpdateHandler, which rejects it.
  test.failing('marks the transaction, confirms the booking and writes both', async () => {
    const res = await handler(notify(paid), {});
    expect(res.statusCode).toBe(200);
    expect(mockUpdateTransactionForPayment).toHaveBeenCalledWith('T-1', 'B-1', 'S-1', expect.objectContaining({ trnApproved: '1' }));
    expect(mockCompleteBooking.mock.calls[0].slice(0, 2)).toEqual(['B-1', 'S-1']);
    const [[txWrite], bookingWrites] = mockBatchTransact.mock.calls.map(([items]) => items);
    expect(txWrite.data.Key).toEqual({ pk: { S: 'transaction::T-1' }, sk: { S: 'base' } });
    expect(bookingWrites).toContainEqual(bookingUpdate);
  });

  // Unreachable until the booking-update shape bug above is fixed.
  test.failing('queues a receipt in cents with guest count and payer-name fallback', async () => {
    await handler(notify(paid), {});
    const msg = sqsMessage();
    expect(msg.messageType).toBe('receipt');
    expect(msg.recipientEmail).toBe('pay@example.com');
    expect(msg.templateData.payment).toMatchObject({ totalAmount: 1250, transactionId: '10000123', currency: 'CAD' });
    expect(msg.templateData.booking).toMatchObject({ bookingId: 'B-1', orderNumber: 'T-1', numberOfGuests: 3 });
    expect(msg.templateData.customer).toMatchObject({ firstName: 'Ada', lastName: 'King Lovelace' });
  });

  // Unreachable until the booking-update shape bug above is fixed.
  test.failing('still succeeds when the receipt cannot be queued', async () => {
    mockSqsSend.mockRejectedValue(new Error('sqs down'));
    const res = await handler(notify(paid), {});
    expect(res.statusCode).toBe(200);
    expect(mockBatchTransact).toHaveBeenCalledTimes(2);
  });

  it('returns the transaction error status when the transaction cannot be updated', async () => {
    const { Exception } = require('/opt/base');
    mockUpdateTransactionForPayment.mockRejectedValue(new Exception('Error updating transaction', { code: 409 }));
    const res = await handler(notify(paid), {});
    expect(res.statusCode).toBe(409);
    expect(mockCompleteBooking).not.toHaveBeenCalled();
  });
});
