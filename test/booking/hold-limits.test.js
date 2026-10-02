'use strict';

jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data?.data || null;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({ unmarshall: jest.fn((x) => x) }));

jest.mock('/opt/dynamodb', () => ({
  batchTransactData: jest.fn(),
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  getOneByGlobalId: jest.fn(),
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
  TRANSACTIONAL_DATA_TABLE_NAME: 'TxTable',
  SPARSE_GSI1_NAME: 'sparse-gsi-1',
  USERID_INDEX_NAME: 'userId-index',
  USERID_PROPERTY_NAME: 'userId',
}));

jest.mock('/opt/ssm', () => ({ getParameter: jest.fn() }));
jest.mock('/opt/sns', () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock('../../lib/handlers/emailDispatch/utils', () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));
jest.mock('../../src/handlers/activities/methods', () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock('../../src/common/data-utils', () => ({
  getAndAttachNestedProperties: jest.fn(),
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));
jest.mock('../../src/handlers/productDates/methods', () => ({ fetchProductDates: jest.fn() }));
jest.mock('../../src/handlers/productDates/configs', () => ({ PUBLIC_PRODUCTDATE_PROJECTIONS: {} }));
jest.mock('../../src/handlers/products/methods', () => ({ getProductById: jest.fn() }));
jest.mock('../../src/handlers/users/methods', () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
}));
jest.mock('../../src/handlers/bookings/configs', () => ({
  BOOKING_PUT_CONFIG: {},
  BOOKINGDATES_PUT_CONFIG: {},
  BOOKING_UPDATE_CONFIG: {},
  BOOKINGHOLD_PUT_CONFIG: {},
}));

const { logger } = require('/opt/base');
const { getParameter } = require('/opt/ssm');
const { runQuery, getOne } = require('/opt/dynamodb');
const { fetchProductDates } = require('../../src/handlers/productDates/methods');
const { quickApiPutHandler } = require('../../src/common/data-utils');
const { getUserInfoBySub } = require('../../src/handlers/users/methods');
const {
  evaluateHoldLimits,
  holdLimitsConfig,
  holdLimitsSwitchOn,
  _resetHoldLimitsSwitch,
} = require('../../src/handlers/bookings/hold-limits');
const { createBooking, findUserBookingsForProductOnDate } = require('../../src/handlers/bookings/methods');

const NOW = Date.UTC(2026, 5, 10, 18, 0, 0);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const LIMITS = { removalsBeforeWait: 3, holdsPerHour: 5, holdsPerDay: 9 };
const PARAMETER = '/reserveRecApi/test/holdLimits/enabled';

// A hold created `ago` ms before NOW with a 15 minute session.
const hold = (ago, extra = {}) => ({
  sessionInitTime: NOW - ago,
  sessionExpiry: NOW - ago + 15 * MIN,
  status: 'cancelled',
  ...extra,
});
// A hold removed `removedAfter` ms into its session.
const removed = (ago, removedAfter = MIN) => hold(ago, { cancellationTime: NOW - ago + removedAfter });

const setLimitEnv = (limits = LIMITS) => {
  process.env.HOLD_REMOVALS_BEFORE_WAIT = String(limits.removalsBeforeWait);
  process.env.HOLD_LIMIT_PER_HOUR = String(limits.holdsPerHour);
  process.env.HOLD_LIMIT_PER_DAY = String(limits.holdsPerDay);
  process.env.HOLD_LIMITS_ENABLED_PARAMETER = PARAMETER;
};
const clearLimitEnv = () => {
  for (const name of ['HOLD_REMOVALS_BEFORE_WAIT', 'HOLD_LIMIT_PER_HOUR', 'HOLD_LIMIT_PER_DAY', 'HOLD_LIMITS_ENABLED_PARAMETER']) {
    delete process.env[name];
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  _resetHoldLimitsSwitch();
  clearLimitEnv();
});

afterEach(() => {
  jest.useRealTimers();
  clearLimitEnv();
});

describe('evaluateHoldLimits', () => {
  describe('removed holds', () => {
    it('counts removed holds and refuses at removalsBeforeWait', () => {
      const two = evaluateHoldLimits([removed(2 * MIN), removed(4 * MIN)], LIMITS, NOW);
      expect(two.removedCount).toBe(2);
      expect(two.refusal).toBeNull();

      const three = evaluateHoldLimits([removed(2 * MIN), removed(4 * MIN), removed(6 * MIN)], LIMITS, NOW);
      expect(three.removedCount).toBe(3);
      expect(three.refusal).toEqual({ code: 'HOLD_COOLDOWN', retryAt: NOW - 6 * MIN + 15 * MIN });
    });

    it('does not count a removal inside the last 60 s of the session', () => {
      const inGrace = removed(14.5 * MIN, 14.5 * MIN);
      const atGrace = removed(14.5 * MIN, 14 * MIN);
      const beforeGrace = removed(14.5 * MIN, 14 * MIN - 1);
      expect(evaluateHoldLimits([inGrace, atGrace, beforeGrace], LIMITS, NOW).removedCount).toBe(1);
    });

    it('does not count a timer expiry', () => {
      const timedOut = hold(2 * MIN, { status: 'TIMED_OUT', timedOutAt: NOW });
      expect(evaluateHoldLimits([timedOut, timedOut, timedOut], LIMITS, NOW).removedCount).toBe(0);
    });

    it('does not count a completed booking that was later cancelled', () => {
      const completedThenCancelled = removed(2 * MIN);
      completedThenCancelled.bookingCompletionTime = NOW - MIN;
      expect(evaluateHoldLimits([completedThenCancelled], LIMITS, NOW).removedCount).toBe(0);
    });

    it('does not count a hold the system released', () => {
      const released = { ...removed(2 * MIN), releasedBy: 'system' };
      expect(evaluateHoldLimits([released, released, released], LIMITS, NOW).removedCount).toBe(0);
    });

    it('stops counting a removal at its sessionExpiry', () => {
      const removal = removed(10 * MIN);
      expect(evaluateHoldLimits([removal], LIMITS, removal.sessionExpiry - 1).removedCount).toBe(1);
      expect(evaluateHoldLimits([removal], LIMITS, removal.sessionExpiry).removedCount).toBe(0);
    });

    it('gives retryAt as the earliest sessionExpiry among them', () => {
      const removals = [removed(1 * MIN), removed(9 * MIN), removed(5 * MIN)];
      const { refusal } = evaluateHoldLimits(removals, LIMITS, NOW);
      expect(refusal.retryAt).toBe(NOW - 9 * MIN + 15 * MIN);
    });
  });

  describe('caps', () => {
    it('refuses at holdsPerHour holds in the last hour, any status', () => {
      const holds = [
        hold(1 * MIN, { status: 'in progress' }),
        hold(10 * MIN, { status: 'confirmed' }),
        hold(20 * MIN, { status: 'TIMED_OUT' }),
        hold(30 * MIN),
        hold(40 * MIN),
      ];
      expect(evaluateHoldLimits(holds.slice(1), LIMITS, NOW).refusal).toBeNull();
      const result = evaluateHoldLimits(holds, LIMITS, NOW);
      expect(result.holdsLastHour).toBe(5);
      expect(result.refusal).toEqual({ code: 'HOLD_CAP', retryAt: NOW - 40 * MIN + HOUR });
    });

    it('does not count a hold created an hour or more ago in the hourly cap', () => {
      const holds = [hold(HOUR), hold(10 * MIN), hold(20 * MIN), hold(30 * MIN), hold(40 * MIN)];
      const result = evaluateHoldLimits(holds, LIMITS, NOW);
      expect(result.holdsLastHour).toBe(4);
      expect(result.holdsLastDay).toBe(5);
      expect(result.refusal).toBeNull();
    });

    it('refuses at holdsPerDay holds in the last 24 hours', () => {
      const holds = [2, 3, 4, 5, 6, 7, 8, 9, 23].map((h) => hold(h * HOUR));
      const result = evaluateHoldLimits(holds, LIMITS, NOW);
      expect(result.holdsLastHour).toBe(0);
      expect(result.holdsLastDay).toBe(9);
      expect(result.refusal).toEqual({ code: 'HOLD_CAP', retryAt: NOW - 23 * HOUR + DAY });
    });

    it('does not count a hold created 24 hours or more ago', () => {
      const holds = [2, 3, 4, 5, 6, 7, 8, 9, 24].map((h) => hold(h * HOUR));
      expect(evaluateHoldLimits(holds, LIMITS, NOW).refusal).toBeNull();
    });

    it('gives the latest retryAt when several limits refuse', () => {
      const holds = [removed(1 * MIN), removed(2 * MIN), removed(3 * MIN), ...[2, 3, 4, 5, 6, 7].map((h) => hold(h * HOUR))];
      expect(evaluateHoldLimits(holds, LIMITS, NOW).refusal).toEqual({ code: 'HOLD_CAP', retryAt: NOW - 7 * HOUR + DAY });
    });

    it('skips a limit that is not set', () => {
      const holds = [removed(1 * MIN), removed(2 * MIN), removed(3 * MIN)];
      const result = evaluateHoldLimits(holds, { holdsPerHour: 5 }, NOW);
      expect(result.refusal).toBeNull();
      expect(result.freeRemovalsLeft).toBeNull();
    });
  });

  it('reports freeRemovalsLeft, never below 0', () => {
    expect(evaluateHoldLimits([], LIMITS, NOW).freeRemovalsLeft).toBe(3);
    expect(evaluateHoldLimits([removed(MIN)], LIMITS, NOW).freeRemovalsLeft).toBe(2);
    const many = [1, 2, 3, 4].map((m) => removed(m * MIN));
    expect(evaluateHoldLimits(many, LIMITS, NOW).freeRemovalsLeft).toBe(0);
  });
});

describe('holdLimitsConfig', () => {
  it('is off when no limit is set', () => {
    expect(holdLimitsConfig({})).toBeNull();
  });

  it('reads the limits from the environment', () => {
    setLimitEnv();
    expect(holdLimitsConfig()).toEqual(LIMITS);
  });
});

describe('holdLimitsSwitchOn', () => {
  beforeEach(() => setLimitEnv());

  it('is off when the parameter is "false"', async () => {
    getParameter.mockResolvedValue('false');
    expect(await holdLimitsSwitchOn()).toBe(false);
    expect(getParameter).toHaveBeenCalledWith(PARAMETER, false);
  });

  it('is on when the parameter is "true"', async () => {
    getParameter.mockResolvedValue('true');
    expect(await holdLimitsSwitchOn()).toBe(true);
  });

  it('is on when the parameter is missing, and logs the error once', async () => {
    getParameter.mockRejectedValue(new Error('ParameterNotFound'));
    expect(await holdLimitsSwitchOn()).toBe(true);
    jest.setSystemTime(NOW + 2 * MIN);
    expect(await holdLimitsSwitchOn()).toBe(true);
    expect(getParameter).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.any(String), { parameter: PARAMETER, error: 'ParameterNotFound' });
  });

  it('caches the value for 60 s', async () => {
    getParameter.mockResolvedValueOnce('false').mockResolvedValueOnce('true');
    expect(await holdLimitsSwitchOn()).toBe(false);
    jest.setSystemTime(NOW + 59 * 1000);
    expect(await holdLimitsSwitchOn()).toBe(false);
    expect(getParameter).toHaveBeenCalledTimes(1);
    jest.setSystemTime(NOW + 60 * 1000);
    expect(await holdLimitsSwitchOn()).toBe(true);
    expect(getParameter).toHaveBeenCalledTimes(2);
  });
});

describe('findUserBookingsForProductOnDate', () => {
  const productPk = 'booking::col-1::dayuse::1::3';

  it('queries the userId-index for the product and date, active or in the window', async () => {
    runQuery.mockResolvedValue({ items: [{ bookingId: 'b-1' }] });
    const items = await findUserBookingsForProductOnDate('sub-1', productPk, '2026-06-15', NOW);
    expect(items).toEqual([{ bookingId: 'b-1' }]);
    const [params, , , paginated] = runQuery.mock.calls[0];
    expect(paginated).toBe(false);
    expect(params.IndexName).toBe('userId-index');
    expect(params.KeyConditionExpression).toBe('#userId = :userId AND begins_with(sk, :startDatePrefix)');
    expect(params.FilterExpression)
      .toBe('pk = :pk AND (#status IN (:inProgress, :confirmed) OR sessionInitTime > :since OR sessionExpiry > :now)');
    expect(params.ExpressionAttributeValues).toMatchObject({
      ':startDatePrefix': '2026-06-15::',
      ':pk': productPk,
      ':inProgress': 'in progress',
      ':confirmed': 'confirmed',
      ':since': NOW - DAY,
      ':now': NOW,
    });
  });

  it('returns nothing without querying when an argument is missing', async () => {
    expect(await findUserBookingsForProductOnDate(null, productPk, '2026-06-15')).toEqual([]);
    expect(await findUserBookingsForProductOnDate('sub-1', null, '2026-06-15')).toEqual([]);
    expect(await findUserBookingsForProductOnDate('sub-1', productPk, null)).toEqual([]);
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe('createBooking with hold limits', () => {
  const props = () => ({
    collectionId: 'col-1', activityType: 'dayuse', activityId: '1', productId: '3',
    startDate: '2026-06-15', endDate: '2026-06-15', invQuantity: 1, userId: 'sub-1',
  });
  const asset = { primaryKey: { pk: 'asset::col-1', sk: 'a-1' } };
  const product = {
    productId: '3', displayName: 'Day pass', timezone: 'America/Vancouver',
    reservationPolicy: { isReservable: true },
  };
  const productDate = {
    collectionId: 'col-1', activityType: 'dayuse', activityId: '1', productId: '3', date: '2026-06-15',
    assetList: [asset],
    reservationContext: { isReservable: true, temporalWindows: { reservationWindow: { open: NOW - DAY, close: NOW + DAY } } },
  };
  const inventoryPk = 'inventoryPool::col-1::dayuse::1::3::2026-06-15';
  const threeRemovals = [removed(2 * MIN), removed(4 * MIN), removed(6 * MIN)];

  const mockStore = ({ bookings = [], availability = 10 } = {}) => {
    runQuery.mockResolvedValue({ items: bookings });
    getOne.mockImplementation(async (pk) => {
      if (pk.startsWith('product::')) return product;
      if (pk.startsWith('inventoryPool::')) return availability === null ? null : { availability };
      return null;
    });
    fetchProductDates.mockResolvedValue([productDate]);
    quickApiPutHandler.mockImplementation(async (table, items) => items.map((i) => ({ action: 'Put', data: { Item: i.data } })));
    getUserInfoBySub.mockResolvedValue({
      Attributes: [{ Name: 'email', Value: 'someone@example.com' }, { Name: 'email_verified', Value: 'true' }],
    });
  };

  it('does not read the switch or add holdLimits when no limit is set', async () => {
    mockStore({ bookings: threeRemovals });
    const result = await createBooking(props());
    expect(getParameter).not.toHaveBeenCalled();
    expect(result.holdLimits).toBeNull();
    expect(result.requestItems.length).toBeGreaterThan(0);
  });

  it('returns freeRemovalsLeft with the hold', async () => {
    setLimitEnv();
    getParameter.mockResolvedValue('true');
    mockStore({ bookings: [removed(2 * MIN)] });
    const result = await createBooking(props());
    expect(result.holdLimits).toEqual({ freeRemovalsLeft: 2 });
  });

  it('refuses with 429, the code and retryAt, and carries the log fields', async () => {
    setLimitEnv();
    getParameter.mockResolvedValue('true');
    mockStore({ bookings: threeRemovals });
    const retryAt = new Date(NOW - 6 * MIN + 15 * MIN).toISOString();

    const error = await createBooking(props()).catch((e) => e);

    expect(error.code).toBe(429);
    expect(error.data).toEqual({ code: 'HOLD_COOLDOWN', retryAt, refusal: 'cooldown' });
    expect(error.logFields).toEqual({
      userSub: 'sub-1',
      productKey: 'col-1::dayuse::1::3',
      date: '2026-06-15',
      removedCount: 3,
      holdsLastHour: 3,
      holdsLastDay: 3,
      retryAt,
    });
  });

  it('tags a cap refusal as cap', async () => {
    setLimitEnv();
    getParameter.mockResolvedValue('true');
    mockStore({ bookings: [10, 20, 30, 40, 50].map((m) => hold(m * MIN)) });
    await expect(createBooking(props())).rejects.toMatchObject({
      code: 429,
      data: { code: 'HOLD_CAP', refusal: 'cap', retryAt: new Date(NOW - 50 * MIN + HOUR).toISOString() },
    });
  });

  it.each([
    ['no availability left', 0],
    ['no inventory pool', null],
  ])('answers sold out over a limit refusal when there is %s', async (_, availability) => {
    setLimitEnv();
    getParameter.mockResolvedValue('true');
    mockStore({ bookings: threeRemovals, availability });
    await expect(createBooking(props())).rejects.toMatchObject({ data: { refusal: 'sold_out' } });
    expect(getOne).toHaveBeenCalledWith(inventoryPk, 'asset::col-1::a-1');
  });

  it('does not read inventory when no limit refuses', async () => {
    setLimitEnv();
    getParameter.mockResolvedValue('true');
    mockStore();
    await createBooking(props());
    expect(getOne).not.toHaveBeenCalledWith(inventoryPk, expect.anything());
  });

  it('creates the hold when the switch is "false"', async () => {
    setLimitEnv();
    getParameter.mockResolvedValue('false');
    mockStore({ bookings: threeRemovals });
    const result = await createBooking(props());
    expect(result.holdLimits).toBeNull();
  });

  it('still refuses a duplicate before the limits', async () => {
    setLimitEnv();
    mockStore({ bookings: [...threeRemovals, { bookingId: 'b-9', status: 'in progress' }] });
    await expect(createBooking(props())).rejects.toMatchObject({ code: 409, data: { refusal: 'has_hold' } });
    expect(getParameter).not.toHaveBeenCalled();
  });
});
