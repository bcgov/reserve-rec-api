'use strict';

process.env.QR_SECRET_KEY = 'test-secret-key-for-unit-tests-only';
process.env.ADMIN_ALTERED_FRONTEND_DOMAIN = 'admin.example.com';

const mockBatchWriteData = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  batchWriteData: (...a) => mockBatchWriteData(...a),
}));
const mockGetBooking = jest.fn();
jest.mock('../../src/handlers/bookings/methods', () => ({ getBookingByBookingId: (...a) => mockGetBooking(...a) }));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { generateQRURL } = require('../../lib/handlers/emailDispatch/qrCodeHelper');
const { handler } = require('../../src/handlers/verify/GET/admin');

describe('GET /verify/{bookingId}/{hash} for a booking that no longer exists', () => {
  it('answers like an invalid code and audits the miss', async () => {
    mockGetBooking.mockResolvedValue(null);
    const bookingId = 'BOOK-12345678';
    const hash = generateQRURL(bookingId).split('/').pop();

    const res = await handler({
      httpMethod: 'GET',
      pathParameters: { bookingId, hash },
      requestContext: { authorizer: { principalId: 'sub-admin', permissions: JSON.stringify({ superadmin: 'superadmin' }) } },
    }, {});

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ msg: 'Invalid QR code', data: { valid: false, reason: 'Invalid or expired QR code' } });
    const [[row]] = mockBatchWriteData.mock.calls.at(-1);
    expect(unmarshall(row)).toMatchObject({ pk: 'sub-admin', operation: 'QR_VERIFY_FAILED', metadata: { reason: 'Booking not found (null)' } });
  });
});
