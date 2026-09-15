jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock('/opt/dynamodb', () => ({ REFERENCE_DATA_TABLE_NAME: 'ref', runScan: jest.fn() }));
const mockSend = jest.fn();
// The Lambda runtime provides this client; it is not a dependency of the repo.
jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn(() => ({ send: mockSend })),
  PutMetricDataCommand: jest.fn((input) => ({ input })),
}), { virtual: true });

process.env.METRIC_NAMESPACE = 'ReserveRecApi/test';
const { runScan } = require('/opt/dynamodb');
const { handler, aggregate, toMetricData } = require('../lib/handlers/inventoryMetrics');

const pool = (product, date, availability, capacity = 200) => ({
  pk: `inventoryPool::bcparks_15::dayuse::2::${product}::${date}`, date, availability, capacity,
});

describe('aggregate', () => {
  it('sums today and the window per activity and product, ignoring dates outside it', () => {
    const groups = aggregate([
      pool(1, '2026-09-15', 50), pool(1, '2026-09-16', 120), pool(1, '2026-09-30', 200),
      pool(2, '2026-09-15', 0),
    ], '2026-09-15', '2026-09-22');
    expect(groups).toEqual([
      { activity: 'bcparks_15::dayuse::2', product: '1', today: { a: 50, c: 200 }, week: { a: 170, c: 400 } },
      { activity: 'bcparks_15::dayuse::2', product: '2', today: { a: 0, c: 200 }, week: { a: 0, c: 200 } },
    ]);
  });
});

describe('toMetricData', () => {
  it('publishes per group and a total, never per date or asset', () => {
    const data = toMetricData(aggregate([pool(1, '2026-09-15', 50), pool(2, '2026-09-15', 10)], '2026-09-15', '2026-09-22'));
    expect(data).toHaveLength(2 * 2 * 2 + 2 * 2);
    const dimNames = new Set(data.flatMap((d) => d.Dimensions.map((x) => x.Name)));
    expect(dimNames).toEqual(new Set(['Activity', 'Product', 'Window']));
    const total = data.find((d) => d.MetricName === 'inventory_available' && d.Dimensions.length === 1 && d.Dimensions[0].Value === 'today');
    expect(total.Value).toBe(60);
  });
});

describe('handler', () => {
  it('scans the window and publishes', async () => {
    runScan.mockResolvedValue({ items: [pool(1, '2099-01-01', 5)] });
    mockSend.mockResolvedValue({});
    await expect(handler()).resolves.toEqual({ pools: 1, groups: 1, metrics: 8 });
    const scan = runScan.mock.calls[0][0];
    expect(scan.FilterExpression).toContain('BETWEEN');
    expect(scan.ProjectionExpression).toBe('pk, #date, availability, #capacity');
    expect(mockSend.mock.calls[0][0].input.Namespace).toBe('ReserveRecApi/test');
  });
});
