// Distinct client networks per token subject, against an in-memory stand-in
// for the DynamoDB table.

const mockLogger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock('/opt/base', () => ({ logger: mockLogger }));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/client-dynamodb'),
  DynamoDBClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
}));

const { unmarshall } = jest.requireActual('@aws-sdk/util-dynamodb');

const SUB = '11111111-2222-4333-8444-555555555555';
const T0 = 1_700_000_000_000;

let rows;
function fakeTable(command) {
  const { input } = command;
  if (command.constructor.name === 'PutItemCommand') {
    const item = unmarshall(input.Item);
    rows.set(`${item.pk}|${item.sk}`, item);
    return {};
  }
  if (command.constructor.name === 'QueryCommand') {
    const { ':sub': sub, ':since': since } = unmarshall(input.ExpressionAttributeValues);
    const count = [...rows.values()].filter((r) => r.pk === sub && r.lastSeen >= since).length;
    return { Count: count };
  }
  throw new Error(`unexpected command ${command.constructor.name}`);
}

function load() {
  let mod;
  jest.isolateModules(() => {
    mod = require('../src/handlers/authorizers/tokenNetworks');
  });
  return mod;
}

describe('networkOf', () => {
  const { networkOf } = load();

  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    [' 203.0.113.1 ', '203.0.113.0/24'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:DB8:0:0:1::5', '2001:db8:0:0::/64'],
    ['2001:0db8:00ab:0012:ffff:0:0:1', '2001:db8:ab:12::/64'],
    ['fe80::', 'fe80:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['::ffff:198.51.100.23', '198.51.100.0/24'],
    ['::FFFF:c633:6417', '198.51.100.0/24'],
  ])('maps %p to %p', (ip, network) => {
    expect(networkOf(ip)).toBe(network);
  });

  it.each([
    'not-an-ip', '256.1.1.1', '1.2.3', '1.2.3.4.5', '2001:db8::1::2', '12345::', ':1:2:3:4:5:6:7',
    '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', '::ffff:300.1.1.1', 'g::1', '', null, undefined, 42,
  ])('returns null for %p', (ip) => {
    expect(networkOf(ip)).toBeNull();
  });
});

describe('checkNetworks', () => {
  let checkNetworks;

  beforeEach(() => {
    jest.clearAllMocks();
    rows = new Map();
    mockSend.mockImplementation(async (command) => fakeTable(command));
    process.env.TOKEN_NETWORKS_TABLE = 'token-networks';
    process.env.TOKEN_NETWORK_LIMIT = '1';
    process.env.TOKEN_NETWORK_WINDOW_SECONDS = '60';
    ({ checkNetworks } = load());
  });

  afterAll(() => {
    delete process.env.TOKEN_NETWORKS_TABLE;
    delete process.env.TOKEN_NETWORK_LIMIT;
    delete process.env.TOKEN_NETWORK_WINDOW_SECONDS;
  });

  it.each([
    ['the limit is unset', () => delete process.env.TOKEN_NETWORK_LIMIT],
    ['the limit is 0', () => { process.env.TOKEN_NETWORK_LIMIT = '0'; }],
    ['the window is unset', () => delete process.env.TOKEN_NETWORK_WINDOW_SECONDS],
  ])('makes no AWS calls when %s', async (_, arrange) => {
    arrange();
    expect(await checkNetworks({ sub: SUB, ip: undefined, now: T0 })).toEqual({ over: false });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockLogger.info).not.toHaveBeenCalled();
  });

  it.each([null, undefined, 'garbage'])('makes no AWS calls and logs a missing ip for %p', async (ip) => {
    expect(await checkNetworks({ sub: SUB, ip, now: T0 })).toEqual({ over: false });
    expect(mockSend).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith('event=viewer_ip_missing', { sub: SUB });
  });

  it('records the network with its last-seen time and TTL', async () => {
    await checkNetworks({ sub: SUB, ip: '2001:db8:1:2::9', now: T0 });
    expect([...rows.values()]).toEqual([
      { pk: SUB, sk: '2001:db8:1:2::/64', lastSeen: T0, expiresAt: 1_700_000_060 },
    ]);
    expect(mockSend.mock.calls[0][0].input.TableName).toBe('token-networks');
  });

  it('is over the limit only once more networks than the limit are in the window', async () => {
    expect(await checkNetworks({ sub: SUB, ip: '203.0.113.1', now: T0 })).toEqual({ over: false, networks: 1 });
    expect(await checkNetworks({ sub: SUB, ip: '203.0.113.200', now: T0 + 1000 })).toEqual({ over: false, networks: 1 });
    expect(await checkNetworks({ sub: SUB, ip: '2001:db8::1', now: T0 + 2000 })).toEqual({ over: true, networks: 2 });
  });

  it('does not count networks last seen before the window, even if not yet deleted', async () => {
    await checkNetworks({ sub: SUB, ip: '203.0.113.1', now: T0 });
    await checkNetworks({ sub: SUB, ip: '198.51.100.1', now: T0 });
    const later = T0 + 60_001;
    expect(await checkNetworks({ sub: SUB, ip: '192.0.2.1', now: later })).toEqual({ over: false, networks: 1 });
  });

  it('counts each subject separately', async () => {
    await checkNetworks({ sub: SUB, ip: '203.0.113.1', now: T0 });
    await checkNetworks({ sub: SUB, ip: '198.51.100.1', now: T0 });
    expect(await checkNetworks({ sub: 'other-sub', ip: '192.0.2.1', now: T0 })).toEqual({ over: false, networks: 1 });
  });

  it('reuses the answer for the same subject and network for 30 seconds', async () => {
    await checkNetworks({ sub: SUB, ip: '203.0.113.1', now: T0 });
    expect(mockSend).toHaveBeenCalledTimes(2);

    expect(await checkNetworks({ sub: SUB, ip: '203.0.113.9', now: T0 + 29_000 })).toEqual({ over: false, networks: 1 });
    expect(mockSend).toHaveBeenCalledTimes(2);

    await checkNetworks({ sub: SUB, ip: '203.0.113.9', now: T0 + 30_001 });
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it('fails open on a DynamoDB error, without caching it', async () => {
    mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));
    expect(await checkNetworks({ sub: SUB, ip: '203.0.113.1', now: T0 })).toEqual({ over: false });
    expect(mockLogger.warn).toHaveBeenCalledWith('Token network check failed; allowing', {
      sub: SUB, error: 'ProvisionedThroughputExceededException',
    });

    expect(await checkNetworks({ sub: SUB, ip: '203.0.113.1', now: T0 + 1000 })).toEqual({ over: false, networks: 1 });
  });
});
