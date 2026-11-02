'use strict';

const mockRunQuery = jest.fn();
const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({
  runQuery: (...a) => mockRunQuery(...a),
  getOne: (...a) => mockGetOne(...a),
  TRANSACTIONAL_DATA_TABLE_NAME: 'trans',
  REFERENCE_DATA_TABLE_NAME: 'ref',
}));

const { handler } = require('../../src/handlers/reports/GET/admin');

// Rows by pk; runQuery honours begins_with(sk, ...) and sk equality like DynamoDB would.
function useTables(rows) {
  mockRunQuery.mockImplementation(async (q) => {
    const v = q.ExpressionAttributeValues;
    const skPrefix = v[':sk']?.S ?? v[':activityType']?.S ?? '';
    const items = (rows[v[':pk'].S] || []).filter((r) => String(r.sk).startsWith(skPrefix));
    return { items };
  });
}

const staff = (collectionId) => JSON.stringify({ [collectionId]: 'staff' });
const event = (qs, permissions = staff('bcparks_7')) => ({
  httpMethod: 'GET',
  queryStringParameters: qs,
  requestContext: { authorizer: { principalId: 'admin-1', permissions } },
});
const body = (res) => JSON.parse(res.body);

const vehicleBooking = {
  sk: '2026-07-01::b1',
  bookingId: 'B-1',
  status: 'confirmed',
  activitySubType: 'vehicleParking',
  startDate: '2026-07-01',
  namedOccupant: {
    firstName: 'Ada', lastName: 'Lovelace',
    contactInfo: { email: 'ada@example.com', homePhone: '250-555-0100', streetAddress: '1 Main', province: 'BC', country: 'CA', postalCode: 'V8V1A1' },
  },
  vehicleInformation: [{ licensePlate: 'ABC123' }],
};
const trailBooking = {
  sk: '2026-07-01::b2',
  globalId: 'G-2',
  status: 'confirmed',
  activitySubType: 'trailUse',
  startDate: '2026-07-01',
  partyInformation: { adult: 2, child: 1, senior: 1, youth: 1 },
};

describe('GET /reports/daily-passes', () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    mockGetOne.mockReset().mockResolvedValue({ displayName: 'Golden Ears' });
  });

  it('answers CORS preflight without touching the database', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' }, {});
    expect(res.statusCode).toBe(200);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'collectionId is required'],
    [{ collectionId: 'bcparks_7' }, 'arrivalDate is required'],
    [{ collectionId: 'bcparks_7', arrivalDate: '2026/07/01' }, 'arrivalDate must be in YYYY-MM-DD format'],
  ])('rejects %j with 400', async (qs, msg) => {
    const res = await handler(event(qs), {});
    expect(res.statusCode).toBe(400);
    expect(body(res).msg).toBe(msg);
  });

  it('rejects an admin without staff on the collection', async () => {
    const res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }, staff('bcparks_8')), {});
    expect(res.statusCode).toBe(403);
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('returns an empty report when the park has no day-use activities', async () => {
    useTables({});
    const res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    expect(res.statusCode).toBe(200);
    expect(body(res).data).toEqual({ items: [], count: 0, collectionId: 'bcparks_7', arrivalDate: '2026-07-01' });
  });

  it('formats bookings across products with park and facility names', async () => {
    useTables({
      'activity::bcparks_7': [
        { sk: 'dayuse::1', activityType: 'dayuse', activityId: '1', facilities: [{ pk: 'facility::bcparks_7', sk: 'trail::9' }] },
        { sk: 'backcountry::2', activityType: 'backcountry', activityId: '2' },
      ],
      'product::bcparks_7::dayuse::1': [{ sk: 'p1' }, { sk: 'p2' }],
      'booking::bcparks_7::dayuse::1::p1': [vehicleBooking, { ...vehicleBooking, sk: '2026-07-02::x', bookingId: 'OTHER-DAY' }],
      'booking::bcparks_7::dayuse::1::p2': [trailBooking],
      'facility::bcparks_7': [{ sk: 'trail::9', displayName: 'Gold Creek' }],
    });

    const res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    const data = body(res).data;

    expect(res.statusCode).toBe(200);
    expect(data.count).toBe(2);
    expect(data.items[0]).toEqual({
      accountName: 'Ada Lovelace',
      emailAddress: 'ada@example.com',
      phoneNumber: '250-555-0100',
      streetAddress: '1 Main',
      provinceTerritory: 'BC',
      country: 'CA',
      postalCode: 'V8V1A1',
      licensePlate: 'ABC123',
      reservationNumber: 'B-1',
      transactionStatus: 'Reserved',
      park: 'Golden Ears (bcparks_7)',
      facility: 'Gold Creek',
      arrivalDate: '2026-07-01',
      passType: 'Vehicle',
      vehiclePassReservedCount: 1,
      vehiclePassCancelledCount: 0,
      trailPassesReservedCount: 0,
      trailPassesCancelledCount: 0,
    });
    expect(data.items[1]).toMatchObject({
      accountName: '',
      reservationNumber: 'G-2',
      passType: 'Trail',
      trailPassesReservedCount: 5,
      vehiclePassReservedCount: 0,
    });
  });

  it.each([
    ['cancelled', 'Cancelled'],
    ['held', 'held'],
    [undefined, ''],
  ])('maps booking status %s to %s and counts no reserved passes', async (status, label) => {
    useTables({
      'activity::bcparks_7': [{ sk: 'dayuse::1', activityType: 'dayuse', activityId: '1' }],
      'product::bcparks_7::dayuse::1': [{ sk: 'p1' }],
      'booking::bcparks_7::dayuse::1::p1': [{ ...trailBooking, status, displayName: 'Booking name' }],
    });
    const res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    expect(body(res).data.items[0]).toMatchObject({ transactionStatus: label, trailPassesReservedCount: 0, facility: 'Booking name' });
  });

  it('falls back to the bare collectionId when the park lookup fails or has no name', async () => {
    useTables({
      'activity::bcparks_7': [{ sk: 'dayuse::1', activityType: 'dayuse', activityId: '1', facilities: [{ pk: 'facility::bcparks_7' }] }],
      'product::bcparks_7::dayuse::1': [{ sk: 'p1' }],
      'booking::bcparks_7::dayuse::1::p1': [vehicleBooking],
    });
    mockGetOne.mockRejectedValueOnce(new Error('gone'));
    let res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    expect(body(res).data.items[0]).toMatchObject({ park: 'bcparks_7', facility: '' });

    mockGetOne.mockResolvedValueOnce({});
    res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    expect(body(res).data.items[0].park).toBe('bcparks_7');
  });

  it('leaves the facility blank when its lookup fails', async () => {
    useTables({
      'activity::bcparks_7': [{ sk: 'dayuse::1', activityType: 'dayuse', activityId: '1', facilities: [{ pk: 'facility::bcparks_7', sk: 'trail::9' }] }],
      'product::bcparks_7::dayuse::1': [{ sk: 'p1' }],
      'booking::bcparks_7::dayuse::1::p1': [vehicleBooking],
    });
    const tables = mockRunQuery.getMockImplementation();
    mockRunQuery.mockImplementation(async (q) => {
      if (q.ExpressionAttributeValues[':pk'].S.startsWith('facility::')) throw new Error('throttled');
      return tables(q);
    });
    const res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    expect(res.statusCode).toBe(200);
    expect(body(res).data.items[0].facility).toBe('');
  });

  it.each([
    ['activity::', 'Error fetching activities'],
    ['product::', 'Error fetching products'],
    ['booking::', 'Error fetching bookings'],
  ])('returns 400 when the %s query fails', async (prefix, msg) => {
    useTables({
      'activity::bcparks_7': [{ sk: 'dayuse::1', activityType: 'dayuse', activityId: '1' }],
      'product::bcparks_7::dayuse::1': [{ sk: 'p1' }],
    });
    const tables = mockRunQuery.getMockImplementation();
    mockRunQuery.mockImplementation(async (q) => {
      if (q.ExpressionAttributeValues[':pk'].S.startsWith(prefix)) throw new Error('throttled');
      return tables(q);
    });
    const res = await handler(event({ collectionId: 'bcparks_7', arrivalDate: '2026-07-01' }), {});
    expect(res.statusCode).toBe(400);
    expect(body(res)).toMatchObject({ msg, error: 'throttled' });
  });
});
