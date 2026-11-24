'use strict';

jest.mock('/opt/base', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('/opt/dynamodb', () => ({ runScan: jest.fn() }));
jest.mock('../../src/handlers/admin-realtime/access', () => ({
  ...jest.requireActual('../../src/handlers/admin-realtime/access'),
  currentAccess: jest.fn(),
}));
jest.mock('../../src/handlers/admin-realtime/publish', () => ({ closeConnection: jest.fn() }));

const { runScan } = require('/opt/dynamodb');
const { accessKey, currentAccess } = require('../../src/handlers/admin-realtime/access');
const { closeConnection } = require('../../src/handlers/admin-realtime/publish');
const { handler } = require('../../src/handlers/admin-realtime/recheck');

const LATER = Math.floor(Date.now() / 1000) + 3600;
const meta = (id, extra = {}) => ({ pk: `CONN#${id}`, sk: 'META', userId: `sub-${id}`, exp: LATER, accessKey: 'key-1', ...extra });

describe('realtime recheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentAccess.mockResolvedValue({ key: 'key-1', permissions: {} });
  });

  it('closes a changed or expired connection and leaves the rest open', async () => {
    runScan.mockResolvedValue({ items: [meta('same'), meta('changed'), meta('expired', { exp: 1 })] });
    currentAccess.mockImplementation(async (m) => ({ key: m.userId === 'sub-changed' ? 'key-2' : 'key-1', permissions: {} }));

    expect(await handler()).toEqual({ checked: 3, closed: 2, failed: 0 });
    expect(closeConnection.mock.calls.map(([id]) => id)).toEqual(['changed', 'expired']);
  });

  it('keeps a connection open when its lookup fails, and checks the rest', async () => {
    runScan.mockResolvedValue({ items: [meta('broken'), meta('changed')] });
    currentAccess.mockRejectedValueOnce(new Error('ddb down')).mockResolvedValueOnce({ key: 'key-2', permissions: {} });

    expect(await handler()).toEqual({ checked: 2, closed: 1, failed: 1 });
    expect(closeConnection).toHaveBeenCalledTimes(1);
    expect(closeConnection).toHaveBeenCalledWith('changed');
  });

  it('does nothing when no one is connected', async () => {
    runScan.mockResolvedValue({ items: [] });
    expect(await handler()).toEqual({ checked: 0, closed: 0, failed: 0 });
  });
});

describe('accessKey', () => {
  it('is the same for the same access whatever the key order, and differs when the role changes', () => {
    expect(accessKey('hqAdmin', { a: 'staff', b: 'limited' })).toBe(accessKey('hqAdmin', { b: 'limited', a: 'staff' }));
    expect(accessKey('hqAdmin', { superadmin: 'superadmin' })).not.toBe(accessKey('superadmin', { superadmin: 'superadmin' }));
  });
});
