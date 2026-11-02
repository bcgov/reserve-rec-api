'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  getOne: jest.fn(),
  batchTransactData: jest.fn(),
}));

const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { getOne, batchTransactData } = require('/opt/dynamodb');
const { handler } = require('../../src/handlers/policies/PUT/admin');

const put = (body, pathParameters) => handler({
  body: JSON.stringify(body),
  pathParameters,
});
const parse = (res) => JSON.parse(res.body);
const ops = () => batchTransactData.mock.calls[0][0];

const existing = (policyType, extra = {}) => ({
  pk: `policy::${policyType}::3`,
  sk: 'latest',
  schema: 'policy',
  policyType,
  policyId: 3,
  identifier: 3,
  policyIdVersion: 2,
  displayName: 'Old name',
  creationDate: '2026-01-01T00:00:00.000Z',
  lastUpdated: '2026-01-02T00:00:00.000Z',
  globalId: 'g-1',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  batchTransactData.mockResolvedValue({ ok: true });
});

describe('PUT /policies/{policyType}/{policyId}', () => {
  it('updates the latest pointer and writes the next version as a new item', async () => {
    getOne.mockResolvedValue(existing('booking'));

    const res = await put({ displayName: 'New name' }, { policyType: 'booking', policyId: '3' });

    expect(res.statusCode).toBe(200);
    expect(getOne).toHaveBeenCalledWith('policy::booking::3', 'latest', expect.any(String));
    const [update, putOp] = ops();
    expect(update.action).toBe('Update');
    expect(unmarshall(update.data.Key)).toEqual({ pk: 'policy::booking::3', sk: 'latest' });
    expect(update.data.ConditionExpression).toBe('attribute_exists(pk)');
    const setValues = Object.values(unmarshall(update.data.ExpressionAttributeValues));
    expect(setValues).toEqual(expect.arrayContaining(['New name', 3]));

    expect(putOp.action).toBe('Put');
    expect(unmarshall(putOp.data.Item)).toMatchObject({
      pk: 'policy::booking::3', sk: 'v3', policyIdVersion: 3, policyId: 3, displayName: 'New name',
    });
    expect(parse(res).data).toEqual({ ok: true });
  });

  it('keeps unchanged fields of the previous version on the new version', async () => {
    getOne.mockResolvedValue(existing('party', { maxSize: 6, description: 'kept' }));

    await put({ maxSize: 8 }, { policyType: 'party', policyId: '3' });

    expect(unmarshall(ops()[1].data.Item)).toMatchObject({ maxSize: 8, description: 'kept', displayName: 'Old name' });
  });

  it.each([
    ['booking', {
      displayName: 'b', description: 'd', minStay: { days: 1 }, maxStay: { days: 7 },
      reservationWindowType: 'fixed', fixedWindowLaunchDate: '2026-12-01', checkInTime: { hour: 14 },
      checkOutTime: { hour: 11 }, noShowTime: { hour: 22 }, adminNotes: 'a', searchTerms: ['s'],
    }],
    ['change', {
      displayName: 'c', description: 'd', areChangesAllowed: false, changeWindowDuration: { days: 2 },
      changeInWindowNightsForfeit: 1, changeSameDayNightsForfeit: 1, isChangeFeeWaivedInWindow: true,
      changesAcceptedUntilTime: { hour: 13 }, cancellationsAcceptedUntilTime: { hour: 12 },
      restrictedWindowDuration: { days: 1 }, adminNotes: 'a', searchTerms: ['s'],
    }],
    ['party', {
      displayName: 'p', description: 'd', minOccupantAge: 18, minSize: 1, maxSize: 4, maxUnitsPerBooking: 1,
      unitType: 'person', maxAdultsTotal: 4, maxYouthTotal: 2, maxChildTotal: 2, maxSeniorTotal: 2,
      maxAdultsPerUnit: 4, maxYouthPerUnit: 2, maxChildPerUnit: 2, maxSeniorPerUnit: 2, maxSizePerUnit: 4,
      maxVehiclesPerUnit: 1, adminNotes: 'a', searchTerms: ['s'], mustProvideAccessPoints: true,
    }],
    ['fee', {
      displayName: 'f', description: 'd', isAcceptingPayments: false, adultNightlyCampingFee: 20,
      youthNightlyCampingFee: 10, childNightlyCampingFee: 5, seniorNightlyCampingFee: 10, baseChangeFee: 9,
      unitChangeFee: 1, baseReservationFee: 6, unitReservationFee: 2, unitType: 'cabin', maxUnitCharge: 90,
      changeSSCFECharge: 1.5, hasSSCFEDiscount: true, additionalVehiclesFee: 5, damageDeposit: 100,
      hasSeniorsDiscount: false, adminNotes: 'a', searchTerms: ['s'], feeRegisterKey: { pk: 'fr', sk: '1' },
    }],
  ])('versions a %s policy with every updatable field', async (policyType, body) => {
    getOne.mockResolvedValue(existing(policyType));

    const res = await put(body, { policyType, policyId: '3' });

    expect(res.statusCode).toBe(200);
    expect(unmarshall(ops()[1].data.Item)).toMatchObject({ ...body, sk: 'v3', policyIdVersion: 3 });
  });

  it('400s on a field that is not updatable and writes nothing', async () => {
    getOne.mockResolvedValue(existing('fee'));
    const res = await put({ policyId: 9 }, { policyType: 'fee', policyId: '3' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe("Field 'policyId' is not allowed to be updated for policyType 'fee' and policyId '3'");
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s when an updatable field fails validation', async () => {
    getOne.mockResolvedValue(existing('fee'));
    const res = await put({ damageDeposit: -5 }, { policyType: 'fee', policyId: '3' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe("Validation failed for field 'damageDeposit'");
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it('400s when the policy does not exist', async () => {
    getOne.mockResolvedValue(undefined);
    const res = await put({ displayName: 'x' }, { policyType: 'party', policyId: '99' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe("No existing policy found for policyType 'party' and policyId '99'");
  });

  it('400s when the stored policy has no usable version number', async () => {
    getOne.mockResolvedValue(existing('party', { policyIdVersion: undefined }));
    const res = await put({ displayName: 'x' }, { policyType: 'party', policyId: '3' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toMatch(/^Error determining new version number/);
  });

  it('400s when reading the policy fails', async () => {
    getOne.mockRejectedValue(new Error('throttled'));
    const res = await put({ displayName: 'x' }, { policyType: 'party', policyId: '3' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting policy by version');
  });

  it.each([
    ['no policyId', { policyType: 'fee' }, 'Body, policy type and policy ID are required'],
    ['no policyType', { policyId: '3' }, 'Body, policy type and policy ID are required'],
  ])('400s with %s', async (_label, pathParameters, msg) => {
    const res = await put({ displayName: 'x' }, pathParameters);
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe(msg);
    expect(getOne).not.toHaveBeenCalled();
  });

  it('400s on an unknown policy type', async () => {
    const res = await put({ displayName: 'x' }, { policyType: 'reservation', policyId: '3' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toMatch(/^Invalid policy type: 'reservation'/);
  });
});
