jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
const mockCognitoSend = jest.fn();
const mockCloudwatchSend = jest.fn();
jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn(() => ({ send: mockCognitoSend })),
  ListUsersCommand: jest.fn((input) => ({ kind: 'ListUsers', input })),
  DescribeUserPoolCommand: jest.fn((input) => ({ kind: 'DescribeUserPool', input })),
}));
// The Lambda runtime provides this client; it is not a dependency of the repo.
jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: mockCloudwatchSend })),
  PutMetricDataCommand: jest.fn((input) => ({ kind: 'PutMetricData', input })),
}), { virtual: true });

process.env.PUBLIC_USER_POOL_ID = 'pool';
process.env.METRIC_NAMESPACE = 'ReserveRecApi/test';
process.env.MAX_PAGES = '2';

const { handler } = require('../lib/handlers/cognitoTriggers/userStatusCount');

const users = (n) => ({ Users: Array.from({ length: n }, (_, i) => ({ Username: `u${i}` })) });

// Pages are keyed by filter so the two scans can be driven independently.
function respond(byFilter, estimated = 40) {
  const seen = {};
  mockCognitoSend.mockImplementation(async (cmd) => {
    if (cmd.kind === 'DescribeUserPool') return { UserPool: { EstimatedNumberOfUsers: estimated } };
    const key = cmd.input.Filter.startsWith('username') ? 'bcsc' : 'unconfirmed';
    seen[key] = (seen[key] || 0);
    const page = (byFilter[key] || [{ n: 0 }])[seen[key]++] || { n: 0 };
    return { ...users(page.n), PaginationToken: page.next };
  });
}

describe('UserStatusCount', () => {
  beforeEach(() => { jest.clearAllMocks(); mockCloudwatchSend.mockResolvedValue({}); });

  it('counts each cohort across pages and publishes all four gauges', async () => {
    respond({ unconfirmed: [{ n: 6, next: 't1' }, { n: 3 }], bcsc: [{ n: 11 }] }, 40);
    await expect(handler()).resolves.toEqual({
      unconfirmed: 9, bcsc: 11, nativeConfirmed: 20, estimated: 40, truncated: false,
    });
    const put = mockCloudwatchSend.mock.calls[0][0].input;
    expect(put.Namespace).toBe('ReserveRecApi/test');
    expect(put.MetricData).toEqual([
      { MetricName: 'unconfirmed_users', Value: 9, Unit: 'Count' },
      { MetricName: 'estimated_users', Value: 40, Unit: 'Count' },
      { MetricName: 'bcsc_users', Value: 11, Unit: 'Count' },
      { MetricName: 'native_confirmed_users', Value: 20, Unit: 'Count' },
    ]);
  });

  it('filters on the unconfirmed status and on the BCSC username prefix, fetching no attributes', async () => {
    respond({});
    await handler();
    const filters = mockCognitoSend.mock.calls
      .filter(([c]) => c.kind === 'ListUsers')
      .map(([c]) => c.input.Filter);
    expect(filters).toContain('cognito:user_status = "UNCONFIRMED"');
    expect(filters).toContain('username ^= "BCSC_"');
    const list = mockCognitoSend.mock.calls.find(([c]) => c.kind === 'ListUsers')[0].input;
    expect(list.AttributesToGet).toEqual([]);
  });

  it('stops at the page cap and reports the count as a floor', async () => {
    respond({ unconfirmed: [{ n: 60, next: 't1' }, { n: 60, next: 't2' }, { n: 60, next: 't3' }] });
    const res = await handler();
    expect(res.unconfirmed).toBe(120);
    expect(res.truncated).toBe(true);
  });

  it('floors native confirmed when the estimate lags the scans', async () => {
    // 40 estimated, but the scans already see 45 accounts between them.
    respond({ unconfirmed: [{ n: 20 }], bcsc: [{ n: 25 }] }, 40);
    await expect(handler()).resolves.toMatchObject({ nativeConfirmed: 0 });
  });
});
