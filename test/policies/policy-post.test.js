'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  incrementCounter: jest.fn(),
  batchTransactData: jest.fn(),
}));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { incrementCounter, batchTransactData } = require('/opt/dynamodb');
const { handler } = require('../../src/handlers/policies/POST/admin');

const post = (body, policyType) => handler({
  body: body === undefined ? undefined : JSON.stringify(body),
  pathParameters: policyType ? { policyType } : undefined,
});
const parse = (res) => JSON.parse(res.body);
const writtenItems = () => batchTransactData.mock.calls[0][0].map((op) => ({
  action: op.action,
  condition: op.data.ConditionExpression,
  item: unmarshall(op.data.Item),
}));

const FULL_BODIES = {
  booking: {
    displayName: 'Standard day-use',
    description: 'Two-day release window',
    minStay: { days: 1 },
    maxStay: { days: 14 },
    reservationWindowType: 'rolling',
    rollingWindowOpenDuration: { days: 2 },
    rollingWindowCloseDuration: { hours: 1 },
    fixedWindowLaunchDate: '2026-11-01',
    reservationOpeningTime: { hour: 7 },
    reservationClosingTime: { hour: 17, minute: 0 },
    checkInTime: { hour: 14 },
    checkOutTime: { hour: 11 },
    noShowTime: { hour: 21 },
    adminNotes: 'internal',
    searchTerms: ['dayuse', 'pass'],
  },
  change: {
    displayName: 'Flexible change',
    description: 'Changes until 2pm',
    areChangesAllowed: true,
    changeWindowDuration: { days: 3 },
    changeInWindowNightsForfeit: 1,
    changeSameDayNightsForfeit: 2,
    isChangeFeeWaivedInWindow: false,
    changesAcceptedUntilTime: { hour: 14 },
    cancellationsAcceptedUntilTime: { hour: 12 },
    restrictedWindowDuration: { days: 1 },
    adminNotes: '',
    searchTerms: ['change'],
  },
  party: {
    displayName: 'Family site',
    description: 'Up to 8 people',
    minOccupantAge: 19,
    minSize: 1,
    maxSize: 8,
    maxUnitsPerBooking: 2,
    unitType: 'site',
    maxAdultsTotal: 4,
    maxYouthTotal: 4,
    maxChildTotal: 4,
    maxSeniorTotal: 4,
    maxAdultsPerUnit: 4,
    maxYouthPerUnit: 4,
    maxChildPerUnit: 4,
    maxSeniorPerUnit: 4,
    maxSizePerUnit: 8,
    maxVehiclesPerUnit: 2,
    adminNotes: 'note',
    searchTerms: ['family'],
    mustProvideAccessPoints: false,
  },
  fee: {
    displayName: 'Frontcountry fees',
    description: 'Nightly camping',
    isAcceptingPayments: true,
    adultNightlyCampingFee: 25,
    youthNightlyCampingFee: 12.5,
    childNightlyCampingFee: 0,
    seniorNightlyCampingFee: 12.25,
    baseChangeFee: 10,
    unitChangeFee: 5,
    baseReservationFee: 6,
    unitReservationFee: 3,
    unitType: 'vehicle',
    maxUnitCharge: 100,
    changeSSCFECharge: 2,
    hasSSCFEDiscount: false,
    additionalVehiclesFee: 10,
    damageDeposit: 50,
    hasSeniorsDiscount: true,
    adminNotes: 'fees',
    searchTerms: ['fee'],
    feeRegisterKey: { pk: 'feeRegister', sk: '2026' },
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  incrementCounter.mockImplementation(async (pk) => (pk === 'policy' ? 7 : 1));
  batchTransactData.mockResolvedValue({});
});

describe('POST /policies/{policyType}', () => {
  it('writes a v1 item and a latest pointer under a new auto-incremented id', async () => {
    const res = await post({ displayName: 'Standard day-use' }, 'booking');

    expect(res.statusCode).toBe(200);
    expect(incrementCounter).toHaveBeenCalledWith('policy', ['booking']);
    expect(incrementCounter).toHaveBeenCalledWith('policy::booking::7', ['version']);
    const [versioned, latest] = writtenItems();
    expect(versioned).toMatchObject({
      action: 'Put',
      condition: 'attribute_not_exists(pk) AND attribute_not_exists(sk)',
      item: {
        pk: 'policy::booking::7', sk: 'v1', schema: 'policy', policyType: 'booking',
        policyId: 7, identifier: 7, policyIdVersion: 1, displayName: 'Standard day-use',
      },
    });
    expect(latest.item).toMatchObject({ pk: 'policy::booking::7', sk: 'latest', policyIdVersion: 1 });
    expect(typeof versioned.item.globalId).toBe('string');
    expect(versioned.item.creationDate).toEqual(expect.any(String));
  });

  it('returns the latest pointer as the response data', async () => {
    const res = await post({ displayName: 'Standard day-use' }, 'booking');
    expect(parse(res).data).toMatchObject({ pk: 'policy::booking::7', sk: 'latest', policyId: 7 });
  });

  it('takes policyType from the body when the path has none', async () => {
    const res = await post({ displayName: 'Fees', policyType: 'fee' });
    expect(res.statusCode).toBe(200);
    expect(writtenItems()[0].item.pk).toBe('policy::fee::7');
  });

  it.each(Object.keys(FULL_BODIES))('accepts every documented %s field', async (policyType) => {
    const res = await post(FULL_BODIES[policyType], policyType);
    expect(res.statusCode).toBe(200);
    expect(writtenItems()[0].item).toMatchObject(FULL_BODIES[policyType]);
  });

  it.each([
    ['booking', 'minStay', { fortnights: 1 }],
    ['booking', 'reservationWindowType', 'sliding'],
    ['booking', 'fixedWindowLaunchDate', '01/11/2026'],
    ['booking', 'checkInTime', {}],
    ['booking', 'searchTerms', [1, 2]],
    ['booking', 'description', 42],
    ['change', 'areChangesAllowed', 'yes'],
    ['change', 'changeInWindowNightsForfeit', 1.5],
    ['change', 'changesAcceptedUntilTime', { hour: 14, day: 1 }],
    ['change', 'restrictedWindowDuration', { days: -1 }],
    ['party', 'maxSize', -2],
    ['party', 'unitType', 'boat'],
    ['party', 'mustProvideAccessPoints', 'false'],
    ['fee', 'adultNightlyCampingFee', 12.345],
    ['fee', 'baseChangeFee', '10'],
    ['fee', 'feeRegisterKey', { pk: 'feeRegister' }],
    ['fee', 'hasSeniorsDiscount', 1],
  ])('400s and writes nothing when %s.%s is %j', async (policyType, field, value) => {
    const res = await post({ ...FULL_BODIES[policyType], [field]: value }, policyType);
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(`Validation failed for field '${field}'`);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s on a field the policy type does not define', async () => {
    const res = await post({ displayName: 'x', maxSize: 4 }, 'fee');
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Invalid field.');
  });

  it('400s when displayName is missing', async () => {
    const res = await post({ description: 'no name' }, 'party');
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe("Mandatory field 'displayName' is missing in the request");
  });

  it('400s when the caller supplies a policyId', async () => {
    const res = await post({ displayName: 'x', policyId: 3 }, 'booking');
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toMatch(/Can't specify policyId/);
    expect(incrementCounter).not.toHaveBeenCalled();
  });

  it.each([['reservation'], [undefined]])('400s on policy type %s', async (policyType) => {
    const res = await post({ displayName: 'x' }, policyType);
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toMatch(/^Invalid policy type/);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s with no body', async () => {
    const res = await post(null, 'booking');
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Body is required');
  });

  it('passes a database failure back as an error response', async () => {
    batchTransactData.mockRejectedValue(Object.assign(new Error('Transaction cancelled'), { code: 409 }));
    const res = await post({ displayName: 'x' }, 'change');
    expect(res.statusCode).toBe(409);
    expect(parse(res).msg).toBe('Transaction cancelled');
  });
});
