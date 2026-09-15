const { logger } = require('/opt/base');
const { REFERENCE_DATA_TABLE_NAME, runScan } = require('/opt/dynamodb');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

/**
 * Scheduled: publish live inventory as metrics.
 *
 * For every activity and product with pools in the window, the availability
 * and capacity summed over today, and over the next `HORIZON_DAYS`. A pool
 * emptying in seconds looks nothing like one draining over an hour, and the
 * dashboard draws that as RATE() on availability — a signal that needs no
 * one identified.
 *
 * Pools are keyed by product and date with no index on the date, so this
 * scans the reference table with a filter. The table is small (megabytes)
 * and the scan runs every five minutes; if it grows, a sparse index on the
 * date is the fix, not a longer schedule.
 *
 * Dimensions are Activity, Product and Window — a handful per environment.
 * Every extra dimension value is a billed metric, so nothing per date and
 * nothing per asset.
 */
const NAMESPACE = process.env.METRIC_NAMESPACE;
const HORIZON_DAYS = Number(process.env.HORIZON_DAYS || 7);
const TIME_ZONE = process.env.TIME_ZONE || 'America/Vancouver';

const cloudwatch = new CloudWatchClient({});

/** YYYY-MM-DD in the booking time zone, `offset` days from now. */
function localDate(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Group pools into {activity, product} -> {today, week} sums. */
function aggregate(pools, today, horizonEnd) {
  const groups = new Map();
  for (const pool of pools) {
    const [, collectionId, activityType, activityId, productId] = String(pool.pk).split('::');
    const key = `${collectionId}::${activityType}::${activityId}|${productId}`;
    if (!groups.has(key)) {
      groups.set(key, { activity: `${collectionId}::${activityType}::${activityId}`, product: productId, today: { a: 0, c: 0 }, week: { a: 0, c: 0 } });
    }
    const g = groups.get(key);
    const a = Number(pool.availability) || 0;
    const c = Number(pool.capacity) || 0;
    if (pool.date === today) { g.today.a += a; g.today.c += c; }
    if (pool.date >= today && pool.date <= horizonEnd) { g.week.a += a; g.week.c += c; }
  }
  return [...groups.values()];
}

function toMetricData(groups) {
  const data = [];
  const totals = { today: { a: 0, c: 0 }, week: { a: 0, c: 0 } };
  for (const g of groups) {
    for (const window of ['today', 'week']) {
      const dims = [
        { Name: 'Activity', Value: g.activity },
        { Name: 'Product', Value: g.product },
        { Name: 'Window', Value: window },
      ];
      data.push({ MetricName: 'inventory_available', Dimensions: dims, Value: g[window].a, Unit: 'Count' });
      data.push({ MetricName: 'inventory_capacity', Dimensions: dims, Value: g[window].c, Unit: 'Count' });
      totals[window].a += g[window].a;
      totals[window].c += g[window].c;
    }
  }
  for (const window of ['today', 'week']) {
    const dims = [{ Name: 'Window', Value: window }];
    data.push({ MetricName: 'inventory_available', Dimensions: dims, Value: totals[window].a, Unit: 'Count' });
    data.push({ MetricName: 'inventory_capacity', Dimensions: dims, Value: totals[window].c, Unit: 'Count' });
  }
  return data;
}

exports.handler = async () => {
  const today = localDate(0);
  const horizonEnd = localDate(HORIZON_DAYS);
  const { items } = await runScan({
    TableName: REFERENCE_DATA_TABLE_NAME,
    FilterExpression: '#schema = :pool AND #date BETWEEN :from AND :to',
    // `capacity` is a DynamoDB reserved word, hence the alias.
    ExpressionAttributeNames: { '#schema': 'schema', '#date': 'date', '#capacity': 'capacity' },
    ExpressionAttributeValues: { ':pool': { S: 'inventoryPool' }, ':from': { S: today }, ':to': { S: horizonEnd } },
    ProjectionExpression: 'pk, #date, availability, #capacity',
  }, null, null, false);

  const groups = aggregate(items, today, horizonEnd);
  const data = toMetricData(groups);
  // PutMetricData takes at most 1000 datums per call.
  for (let i = 0; i < data.length; i += 1000) {
    await cloudwatch.send(new PutMetricDataCommand({ Namespace: NAMESPACE, MetricData: data.slice(i, i + 1000) }));
  }
  logger.info('event=inventory_published', { pools: items.length, groups: groups.length, metrics: data.length, today, horizonEnd });
  return { pools: items.length, groups: groups.length, metrics: data.length };
};

exports.aggregate = aggregate;
exports.toMetricData = toMetricData;
