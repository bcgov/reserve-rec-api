'use strict';

// Public booking POST end to end: real handler, booking methods and relationship
// lookup; only DynamoDB, Cognito and the product date fetch are replaced.

jest.mock('/opt/dynamodb', () => require('../helpers/dynamoIo').mockModule());
jest.mock('/opt/sns', () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock('../../lib/handlers/emailDispatch/utils', () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));
jest.mock('../../src/handlers/activities/methods', () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock('../../src/handlers/productDates/methods', () => ({ fetchProductDates: jest.fn() }));
jest.mock('../../src/handlers/users/methods', () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
}));

const { logger } = require('/opt/base');
const { runQuery, getOne, batchTransactData } = require('/opt/dynamodb');
const { fetchProductDates } = require('../../src/handlers/productDates/methods');
const { getUserInfoBySub } = require('../../src/handlers/users/methods');
const { handler } = require('../../src/handlers/bookings/POST/public');
const { parse } = require('../helpers/adminEvent');

const NOW = Date.UTC(2026, 5, 10, 18, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const COL = 'bcparks_1';
const ACTIVITY_GSIPK = `rel::activity::${COL}::backcountryCamp::3`;

const product = { productId: '4', displayName: 'Camping', timezone: 'America/Vancouver', reservationPolicy: { isReservable: true } };
const asset = { primaryKey: { pk: `asset::${COL}`, sk: 'a-1' } };
const productDate = {
  collectionId: COL, activityType: 'backcountryCamp', activityId: '3', productId: '4', date: '2026-06-15',
  assetList: [asset],
  reservationContext: { isReservable: true, temporalWindows: { reservationWindow: { open: NOW - DAY, close: NOW + DAY } } },
};

// Relationship row from the activity's GSI side, unmarshalled as runQuery returns it.
const link = (pk1, sk1) => ({
  pk: `rel::${pk1}::${sk1}`, sk: `activity::${COL}::backcountryCamp::3`, pk1, sk1,
  pk2: `activity::${COL}`, sk2: 'backcountryCamp::3',
});
const CAMP_A = link(`facility::${COL}`, 'campground::1');
const CAMP_B = link(`facility::${COL}`, 'campground::2');

const event = (body = {}) => ({
  body: JSON.stringify({
    collectionId: COL, activityType: 'backcountryCamp', activityId: '3', productId: '4',
    startDate: '2026-06-15', quantity: 1, ...body,
  }),
  requestContext: { authorizer: { isAuthenticated: 'true', userId: 'sub-1', username: 'user-1' } },
});

const store = (links) => {
  runQuery.mockImplementation(async (query) => {
    if (query.IndexName === 'entityRelationship-index') {
      return { items: query.ExpressionAttributeValues[':gsipk'].S === ACTIVITY_GSIPK ? links : [] };
    }
    return { items: [] };
  });
  getOne.mockImplementation(async (pk) => {
    if (pk.startsWith('product::')) return product;
    if (pk.startsWith('inventoryPool::')) return { availability: 10 };
    return null;
  });
  fetchProductDates.mockResolvedValue([productDate]);
  getUserInfoBySub.mockResolvedValue({
    Attributes: [{ Name: 'email', Value: 'someone@example.com' }, { Name: 'email_verified', Value: 'true' }],
  });
  batchTransactData.mockResolvedValue({});
};

// The booking item the handler wrote, or undefined when nothing was written.
const writtenBooking = () => {
  const items = batchTransactData.mock.calls[0]?.[0] || [];
  const put = items.find((item) => item.data?.Item?.schema?.S === 'booking');
  return put && put.data.Item;
};
const writtenFacilityKeys = () => writtenBooking()?.facilityKeys?.L.map((key) => key.S);

beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.spyOn(logger, 'info').mockImplementation(() => {});
  jest.spyOn(logger, 'debug').mockImplementation(() => {});
  jest.spyOn(logger, 'warn').mockImplementation(() => {});
  jest.spyOn(logger, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('booking facilityKeys', () => {
  it('takes the only linked facility, read from the activity side of the relationship index', async () => {
    store([CAMP_A]);
    const res = parse(await handler(event(), {}));

    expect(res.status).toBe(200);
    expect(writtenFacilityKeys()).toEqual([`${COL}::campground::1`]);
    expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({
      IndexName: 'entityRelationship-index',
      ExpressionAttributeValues: { ':gsipk': { S: ACTIVITY_GSIPK }, ':gsisk': { S: 'facility::' } },
    }), null, null, false);
  });

  it('accepts the only facility named in the request', async () => {
    store([CAMP_A]);
    const res = parse(await handler(event({ facilityKeys: [`${COL}::campground::1`] }), {}));
    expect(res.status).toBe(200);
    expect(writtenFacilityKeys()).toEqual([`${COL}::campground::1`]);
  });

  it('keeps the facility collection when the facility sits in another collection than the activity', async () => {
    store([link('facility::bcparks_9', 'campground::5')]);
    await handler(event(), {});
    expect(writtenFacilityKeys()).toEqual(['bcparks_9::campground::5']);
  });

  it('leaves out and logs a link whose pk1 is not a facility', async () => {
    const stray = link(`geozone::${COL}`, '7');
    store([stray, CAMP_A]);
    await handler(event(), {});
    expect(writtenFacilityKeys()).toEqual([`${COL}::campground::1`]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(`${COL}::backcountryCamp::3`), { skipped: [stray] });
  });

  it('books the facilities the request names on a multi-facility activity', async () => {
    store([CAMP_A, CAMP_B, link(`facility::${COL}`, 'campground::3')]);
    const keys = [`${COL}::campground::2`, `${COL}::campground::1`];
    const res = parse(await handler(event({ facilityKeys: keys }), {}));
    expect(res.status).toBe(200);
    expect(writtenFacilityKeys()).toEqual(keys);
  });

  it.each([
    ['names a facility of another activity', [CAMP_A], { facilityKeys: [`${COL}::campground::2`] }],
    ['names one of its facilities and one other', [CAMP_A, CAMP_B], { facilityKeys: [`${COL}::campground::1`, `${COL}::campground::9`] }],
    ['names the right facility under the activity collection instead of its own', [link('facility::bcparks_9', 'campground::5')], { facilityKeys: [`${COL}::campground::5`] }],
    ['sends no facilityKeys for a multi-facility activity', [CAMP_A, CAMP_B], {}],
    ['sends an empty list', [CAMP_A, CAMP_B], { facilityKeys: [] }],
    ['sends a string instead of a list', [CAMP_A], { facilityKeys: `${COL}::campground::1` }],
    ['names a facility for an activity without a facility link', [], { facilityKeys: [`${COL}::campground::1`] }],
  ])('refuses with 400 and writes nothing when the request %s', async (_, links, body) => {
    store(links);
    const res = parse(await handler(event(body), {}));
    expect(res.status).toBe(400);
    expect(res.data).toEqual({ refusal: 'invalid' });
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('books an activity without a facility link with empty facilityKeys and logs the activity', async () => {
    store([link(`geozone::${COL}`, '7')]);
    const res = parse(await handler(event(), {}));

    expect(res.status).toBe(200);
    expect(writtenFacilityKeys()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(`Activity ${COL}::backcountryCamp::3 has no facility link; booking stored with no facilityKeys`);
  });
});
