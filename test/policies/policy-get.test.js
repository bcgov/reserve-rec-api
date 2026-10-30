'use strict';

jest.mock('/opt/dynamodb', () => ({
  ...jest.requireActual('/opt/dynamodb'),
  getOne: jest.fn(),
  getByGSI: jest.fn(),
  runQuery: jest.fn(),
  batchGetData: jest.fn(),
}));

const { getOne, getByGSI, runQuery, batchGetData } = require('/opt/dynamodb');
const { handler } = require('../../src/handlers/policies/GET/admin');
const { handler: deleteHandler } = require('../../src/handlers/policies/DELETE/admin');

const get = (pathParameters, queryStringParameters) => handler({ pathParameters, queryStringParameters });
const parse = (res) => JSON.parse(res.body);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /policies', () => {
  it('answers a CORS preflight without touching the table', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' });
    expect(res.statusCode).toBe(200);
    expect(getOne).not.toHaveBeenCalled();
  });

  it('lists every policy type through the entity-relationship index', async () => {
    getByGSI.mockImplementation(async (_prop, value) => (
      value === 'policy::fee' ? undefined : { items: [{ pk: `${value}::1` }] }
    ));

    const res = await get();

    expect(res.statusCode).toBe(200);
    expect(getByGSI.mock.calls.map((c) => c[1])).toEqual([
      'policy::reservation', 'policy::change', 'policy::party', 'policy::fee',
    ]);
    expect(getByGSI.mock.calls[0][3]).toBe('entityRelationship-index');
    expect(parse(res).data).toEqual([
      { pk: 'policy::reservation::1' }, { pk: 'policy::change::1' }, { pk: 'policy::party::1' },
    ]);
  });

  it('queries every version of one policy by id', async () => {
    runQuery.mockResolvedValue({ items: [{ sk: 'v1' }, { sk: 'latest' }] });

    const res = await get({ policyType: 'fee', policyId: '4' }, { limit: '10' });

    expect(res.statusCode).toBe(200);
    const [query, limit] = runQuery.mock.calls[0];
    expect(query.KeyConditionExpression).toBe('pk = :pk');
    expect(query.ExpressionAttributeValues[':pk']).toEqual({ S: 'policy::fee::4' });
    expect(limit).toBe('10');
    expect(parse(res).data.items).toHaveLength(2);
  });

  it('400s when the version query fails', async () => {
    runQuery.mockRejectedValue(new Error('boom'));
    const res = await get({ policyType: 'fee', policyId: '4' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Error getting policy');
  });

  it('400s when policyId is given without a policyType', async () => {
    const res = await get({ policyId: '4' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('policyType is required');
    expect(runQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['a numeric version', '2', 'v2'],
    ['latest', 'latest', 'latest'],
    ['an already-prefixed version', 'v5', 'v5'],
  ])('fetches %s of a policy', async (_label, policyIdVersion, expectedSk) => {
    getOne.mockResolvedValue({ sk: expectedSk });
    const res = await get({ policyType: 'party', policyId: '4', policyIdVersion });
    expect(getOne).toHaveBeenCalledWith('policy::party::4', expectedSk, expect.any(String));
    expect(parse(res).data).toEqual({ sk: expectedSk });
  });

  it('400s when only a policyType is given', async () => {
    const res = await get({ policyType: 'fee' });
    expect(res.statusCode).toBe(400);
    expect(parse(res).msg).toBe('Policy ID (policyId) is required when fetching policies by type');
  });

  describe('?product=true', () => {
    const query = { product: 'true', productPk: 'product::bcparks_1::dayuse', productSk: '1' };

    it('batch-gets each distinct policy referenced by the product', async () => {
      getOne.mockResolvedValue({
        reservationPolicy: { primaryKey: { pk: 'policy::booking::1', sk: 'latest' } },
        partyPolicy: { pk: 'policy::party::2', sk: 'v3' },
        feePolicy: { pk: 'policy::booking::1', sk: 'latest' },
        changePolicy: { pk: 'policy::change::5' },
      });
      batchGetData.mockResolvedValue([{ pk: 'policy::booking::1' }, { pk: 'policy::party::2' }]);

      const res = await get(undefined, query);

      expect(getOne).toHaveBeenCalledWith('product::bcparks_1::dayuse', '1');
      expect(batchGetData).toHaveBeenCalledWith(
        [{ pk: 'policy::booking::1', sk: 'latest' }, { pk: 'policy::party::2', sk: 'v3' }],
        expect.any(String),
      );
      expect(parse(res).data).toEqual([{ pk: 'policy::booking::1' }, { pk: 'policy::party::2' }]);
    });

    it('returns an empty list when the product has no policies', async () => {
      getOne.mockResolvedValue({ displayName: 'bare product' });
      const res = await get(undefined, query);
      expect(parse(res).data).toEqual([]);
      expect(batchGetData).not.toHaveBeenCalled();
    });

    it('400s when the product does not exist', async () => {
      getOne.mockResolvedValue(undefined);
      const res = await get(undefined, query);
      expect(res.statusCode).toBe(400);
      expect(parse(res).msg).toBe('Error getting policies by product');
    });

    it('400s without productPk and productSk', async () => {
      const res = await get(undefined, { product: 'true', productPk: 'p' });
      expect(res.statusCode).toBe(400);
      expect(parse(res).msg).toBe('Product PK and SK are required when product flag is set');
      expect(getOne).not.toHaveBeenCalled();
    });
  });
});

describe('DELETE /policies', () => {
  it('is not implemented', async () => {
    const res = await deleteHandler({ pathParameters: { policyType: 'fee', policyId: '1' } });
    expect(res.statusCode).toBe(501);
    expect(parse(res).msg).toBe('Not Implemented');
  });
});
