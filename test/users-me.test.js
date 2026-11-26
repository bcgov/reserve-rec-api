'use strict';

jest.mock('/opt/dynamodb', () => ({ getOne: jest.fn() }));

const { getOne } = require('/opt/dynamodb');
const { handler } = require('../src/handlers/users/me/GET/index');

const K7A = 'bcparks_7::structure::1';
const K7B = 'bcparks_7::structure::2';
const ALL = JSON.stringify({ superadmin: 'superadmin' });

const event = (authorizer) => ({ requestContext: { authorizer: { principalId: 'sub-1', ...authorizer } } });
const body = (res) => JSON.parse(res.body);

const OPERATOR = {
  pk: 'operator::op-1',
  sk: 'base',
  facilities: {
    [K7A]: { orcs: 7, displayName: 'Cheakamus' },
    [K7B]: { orcs: 7, displayName: 'Diamond Head' },
  },
};

describe('GET /users/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOne.mockResolvedValue(OPERATOR);
  });

  it.each([
    ['the SuperAdmin group', { role: 'superadmin', isAdmin: 'true', permissions: ALL }, 'superadmin'],
    ['HQ Admin', { role: 'hqAdmin', permissions: ALL }, 'hqAdmin'],
  ])('returns the role for %s, with no facility list', async (_, authorizer, role) => {
    const res = await handler(event(authorizer), {});

    expect(res.statusCode).toBe(200);
    expect(body(res).data).toEqual({ sub: 'sub-1', permissions: { superadmin: 'superadmin' }, role });
    expect(getOne).not.toHaveBeenCalled();
  });

  it('returns a scoped role with only the facilities in the context, named from the operator record', async () => {
    const res = await handler(event({ role: 'parkStaff', operatorId: 'op-1', permissions: '{}', facilities: JSON.stringify([K7A]) }), {});

    expect(getOne).toHaveBeenCalledWith('operator::op-1', 'base');
    expect(body(res).data).toEqual({
      sub: 'sub-1',
      permissions: {},
      role: 'parkStaff',
      facilities: [{ key: K7A, orcs: 7, displayName: 'Cheakamus' }],
    });
  });

  it('still lists the context facilities when the operator record cannot be read', async () => {
    getOne.mockRejectedValue(new Error('ddb down'));

    const res = await handler(event({ role: 'parkOperator', operatorId: 'op-1', permissions: '{}', facilities: JSON.stringify([K7A]) }), {});

    expect(res.statusCode).toBe(200);
    expect(body(res).data.facilities).toEqual([{ key: K7A, orcs: null, displayName: null }]);
  });

  it('returns no role for a record with a tier map, or with no usable record', async () => {
    const tiers = await handler(event({ permissions: JSON.stringify({ bcparks_7: 'staff' }) }), {});
    expect(body(tiers).data).toEqual({ sub: 'sub-1', permissions: { bcparks_7: 'staff' }, role: null });

    const none = await handler(event({ permissions: '{}' }), {});
    expect(body(none).data).toEqual({ sub: 'sub-1', permissions: {}, role: null });
  });

  it('answers a malformed authorizer context with no role and no permissions', async () => {
    const res = await handler(event({ role: 'parkStaff', permissions: '{}', facilities: 'not-json' }), {});

    expect(res.statusCode).toBe(200);
    expect(body(res).data).toEqual({ sub: 'sub-1', permissions: {}, role: null });
  });
});
