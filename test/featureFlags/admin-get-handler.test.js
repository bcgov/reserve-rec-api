'use strict';

jest.mock('/opt/dynamodb', () => ({
  getOne: jest.fn(),
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
}));

const { getOne } = require('/opt/dynamodb');
const { handler } = require('../../src/handlers/featureFlags/GET/admin');

function event(permissions) {
  return {
    httpMethod: 'GET',
    requestContext: {
      authorizer: { principalId: 'user-1', permissions: JSON.stringify(permissions) },
    },
  };
}

const body = (res) => JSON.parse(res.body);

describe('GET /featureFlags/admin handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOne.mockResolvedValue({
      flags: { enablePayments: false },
      metadata: { enablePayments: { updatedBy: 'user-1' } },
      version: 4,
    });
  });

  it('returns flags, metadata and version to a superadmin', async () => {
    const res = await handler(event({ superadmin: 'superadmin' }), {});

    expect(res.statusCode).toBe(200);
    expect(body(res).data).toEqual({
      flags: { enablePayments: false },
      metadata: { enablePayments: { updatedBy: 'user-1' } },
      version: 4,
    });
    expect(getOne).toHaveBeenCalledWith('config', 'featureFlags', 'RefTable');
  });

  it('falls back to defaults when no record exists', async () => {
    getOne.mockResolvedValue(undefined);

    const res = await handler(event({ superadmin: 'superadmin' }), {});

    expect(body(res).data).toEqual({ flags: { enablePayments: true }, metadata: null, version: 0 });
  });

  it.each([
    ['staff', { bcparks_1: 'staff' }],
    ['limited', { bcparks_1: 'limited' }],
    ['no permissions', {}],
  ])('refuses a %s caller with 403 and reads nothing', async (_label, permissions) => {
    const res = await handler(event(permissions), {});

    expect(res.statusCode).toBe(403);
    expect(body(res).data).toBeNull();
    expect(getOne).not.toHaveBeenCalled();
  });

  it('answers a CORS preflight without checking auth', async () => {
    const res = await handler({ httpMethod: 'OPTIONS' }, {});

    expect(res.statusCode).toBe(200);
    expect(getOne).not.toHaveBeenCalled();
  });
});
