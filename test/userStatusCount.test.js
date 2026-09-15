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

function respond(pages, estimated = 40) {
  let i = 0;
  mockCognitoSend.mockImplementation(async (cmd) => {
    if (cmd.kind === 'DescribeUserPool') return { UserPool: { EstimatedNumberOfUsers: estimated } };
    const page = pages[i++];
    return { ...users(page.n), PaginationToken: page.next };
  });
}

describe('UserStatusCount', () => {
  beforeEach(() => { jest.clearAllMocks(); mockCloudwatchSend.mockResolvedValue({}); });

  it('counts unconfirmed users across pages and publishes both gauges', async () => {
    respond([{ n: 60, next: 't1' }, { n: 3, next: undefined }]);
    await expect(handler()).resolves.toEqual({ unconfirmed: 63, estimated: 40, truncated: false });
    const put = mockCloudwatchSend.mock.calls[0][0].input;
    expect(put.Namespace).toBe('ReserveRecApi/test');
    expect(put.MetricData).toEqual([
      { MetricName: 'unconfirmed_users', Value: 63, Unit: 'Count' },
      { MetricName: 'estimated_users', Value: 40, Unit: 'Count' },
    ]);
  });

  it('filters on the unconfirmed status and fetches no attributes', async () => {
    respond([{ n: 0 }]);
    await handler();
    const list = mockCognitoSend.mock.calls.find(([c]) => c.kind === 'ListUsers')[0].input;
    expect(list.Filter).toBe('cognito:user_status = "UNCONFIRMED"');
    expect(list.AttributesToGet).toEqual([]);
  });

  it('stops at the page cap and reports the count as a floor', async () => {
    respond([{ n: 60, next: 't1' }, { n: 60, next: 't2' }, { n: 60, next: 't3' }]);
    await expect(handler()).resolves.toEqual({ unconfirmed: 120, estimated: 40, truncated: true });
  });
});
