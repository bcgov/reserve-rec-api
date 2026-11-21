jest.mock('/opt/dynamodb', () => ({
  TRANSACTIONAL_DATA_TABLE_NAME: 'TestTable',
  marshall: jest.fn((v) => ({ S: v })),
  batchTransactData: jest.fn(),
  getOne: jest.fn(),
  isConditionFailure: jest.requireActual('../src/layers/awsUtils/dynamodb.js').isConditionFailure,
}));

jest.mock('../src/handlers/bookings/methods', () => ({
  getExpiredBookings: jest.fn(),
  deleteBookingHoldMarker: jest.fn(() => ({ action: 'Delete', data: {} })),
}));

const mockSqsSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((input) => ({ input })),
}));

const { handler } = require('../lib/handlers/incompleteBookingScraper');
const { batchTransactData, getOne } = require('/opt/dynamodb');
const { getExpiredBookings } = require('../src/handlers/bookings/methods');

const expiredInProgressBooking = (overrides = {}) => ({
  pk: 'booking::bcparks_1::camping::a1::p1',
  sk: '2026-09-15::g1',
  bookingId: 'g1',
  status: 'in progress',
  sessionExpiry: Date.now() - 1000,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  batchTransactData.mockResolvedValue(true);
  mockSqsSend.mockResolvedValue({});
});

describe('incompleteBookingScraper timeout update', () => {
  it('sets timedOutAt alongside status in the same conditional update', async () => {
    const booking = expiredInProgressBooking();
    getExpiredBookings.mockResolvedValue({ items: [{ pk: booking.pk, sk: booking.sk, bookingId: booking.bookingId }] });
    getOne.mockResolvedValue(booking);

    const before = Date.now();
    await handler({}, {});
    const after = Date.now();

    const timeoutCall = batchTransactData.mock.calls.find(
      ([items]) => items?.[0]?.data?.UpdateExpression?.includes('#status')
    );
    expect(timeoutCall).toBeDefined();
    const [timeoutItems] = timeoutCall;
    const { data } = timeoutItems[0];

    expect(data.UpdateExpression).toBe('SET #status = :timedOut, #timedOutAt = :timedOutAt');
    expect(data.ExpressionAttributeNames).toEqual({ '#status': 'status', '#timedOutAt': 'timedOutAt' });
    expect(data.ExpressionAttributeValues[':timedOut']).toEqual({ S: 'TIMED_OUT' });

    const timedOutAt = Number(data.ExpressionAttributeValues[':timedOutAt'].N);
    expect(data.ExpressionAttributeValues[':timedOutAt']).toEqual({ N: expect.any(String) });
    expect(timedOutAt).toBeGreaterThanOrEqual(before);
    expect(timedOutAt).toBeLessThanOrEqual(after);
  });

  it('does not touch timedOutAt for a booking that is already TIMED_OUT', async () => {
    const booking = expiredInProgressBooking({ status: 'TIMED_OUT' });
    getExpiredBookings.mockResolvedValue({ items: [{ pk: booking.pk, sk: booking.sk, bookingId: booking.bookingId }] });
    getOne.mockResolvedValue(booking);

    await handler({}, {});

    const timeoutCall = batchTransactData.mock.calls.find(
      ([items]) => items?.[0]?.data?.UpdateExpression?.includes('#timedOutAt')
    );
    expect(timeoutCall).toBeUndefined();
  });

  it('times the booking out only if no payment for it is underway, in the same transaction', async () => {
    const booking = expiredInProgressBooking();
    getExpiredBookings.mockResolvedValue({ items: [{ pk: booking.pk, sk: booking.sk, bookingId: booking.bookingId }] });
    getOne.mockResolvedValue(booking);

    await handler({}, {});

    const [items] = batchTransactData.mock.calls[0];
    const check = items.find((item) => item.action === 'ConditionCheck');
    expect(check.data.Key).toEqual({ pk: { S: 'transaction::g1' }, sk: { S: 'payment' } });
    expect(check.data.ConditionExpression).toBe('attribute_not_exists(pk) OR #status IN (:failed, :void)');
  });

  it('keeps the hold and returns no inventory while the booking is being paid for', async () => {
    const booking = expiredInProgressBooking();
    getExpiredBookings.mockResolvedValue({ items: [{ pk: booking.pk, sk: booking.sk, bookingId: booking.bookingId }] });
    getOne.mockResolvedValue(booking);
    batchTransactData.mockRejectedValueOnce(Object.assign(new Error('Transaction cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
    }));

    await handler({}, {});

    expect(mockSqsSend).not.toHaveBeenCalled();
    expect(batchTransactData).toHaveBeenCalledTimes(1);
  });
});
