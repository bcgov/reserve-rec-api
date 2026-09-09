'use strict';

// Unit test for the facility create duplicate-name guard
// (bcgov/reserve-rec-admin#392).

jest.mock('/opt/base', () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  sendResponse: jest.fn((code, data, message, error) => ({ statusCode: code, message, error })),
  checkAuthContext: jest.fn(() => ({ isAuthenticated: true })),
}));

jest.mock('/opt/dynamodb', () => ({
  REFERENCE_DATA_TABLE_NAME: 'RefTable',
  batchTransactData: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/common/data-utils', () => ({
  quickApiPutHandler: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/handlers/facilities/configs', () => ({ FACILITY_API_PUT_CONFIG: {} }));

jest.mock('../../src/handlers/facilities/methods', () => ({
  parseRequest: jest.fn().mockResolvedValue({}),
  getFacilitiesByCollectionId: jest.fn(),
}));

const { getFacilitiesByCollectionId, parseRequest } = require('../../src/handlers/facilities/methods');
const { handler } = require('../../src/handlers/facilities/_collectionId/POST/admin');

const event = (body) => ({
  pathParameters: { collectionId: 'park-1' },
  queryStringParameters: { facilityType: 'parkingLot' },
  body: JSON.stringify(body),
});

beforeEach(() => {
  jest.clearAllMocks();
  getFacilitiesByCollectionId.mockResolvedValue({ items: [{ displayName: 'Lot A' }] });
});

describe('facility create duplicate-name guard', () => {
  it('fetches all pages of existing facilities (paginated: false)', async () => {
    await handler(event({ displayName: 'Lot B' }), {});
    expect(getFacilitiesByCollectionId).toHaveBeenCalledWith('park-1', {}, { paginated: false });
  });

  it('409s on a name already used in the park, case/space-insensitive', async () => {
    const res = await handler(event({ displayName: '  lot a  ' }), {});
    expect(res.statusCode).toBe(409);
    expect(parseRequest).not.toHaveBeenCalled();
  });

  it('keeps the caller casing in the 409 message', async () => {
    const res = await handler(event({ displayName: 'LOT A' }), {});
    expect(res.message).toContain('"LOT A"');
  });

  it('409s when a batch body repeats a name against itself', async () => {
    const res = await handler(
      event([{ displayName: 'New Lot' }, { displayName: 'new lot' }]),
      {},
    );
    expect(res.statusCode).toBe(409);
    expect(getFacilitiesByCollectionId).not.toHaveBeenCalled();
  });

  it('allows a unique name through to create', async () => {
    const res = await handler(event({ displayName: 'Lot C' }), {});
    expect(res.statusCode).toBe(200);
  });
});
