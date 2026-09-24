const { logger } = require('/opt/base');
const { CognitoIdentityProviderClient, ListUsersCommand, DescribeUserPoolCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

/**
 * Scheduled: publish the pool's makeup — total, BCSC, and the native accounts
 * split by whether they ever confirmed.
 *
 * These are stocks, not flows, so they are gauges written directly rather than
 * event= lines summed by a metric filter. Signups that never confirm are the
 * shape a bot leaves, and the number rising on its own is the signal.
 *
 * ListUsers is paged at 60 and each filtered scan reads only its own subset,
 * so a walk is capped; past the cap the count is a floor and the metric says
 * so. The total comes from DescribeUserPool's estimate, which is free and
 * updated daily.
 *
 * Native confirmed is derived rather than scanned: a third walk would read the
 * whole pool, and the three numbers already bound it. BCSC accounts are
 * federated, so they are never UNCONFIRMED — the unconfirmed count is native
 * by construction.
 */
const POOL_ID = process.env.PUBLIC_USER_POOL_ID;
const NAMESPACE = process.env.METRIC_NAMESPACE;
const MAX_PAGES = Number(process.env.MAX_PAGES || 50);

const cognito = new CognitoIdentityProviderClient({});
const cloudwatch = new CloudWatchClient({});

// Cognito's username prefix for federated BCSC accounts — the same test
// PostConfirmation uses to mark a user EXTERNAL_PROVIDER.
const BCSC_FILTER = 'username ^= "BCSC_"';
const UNCONFIRMED_FILTER = 'cognito:user_status = "UNCONFIRMED"';

async function countMatching(filter) {
  let count = 0;
  let pages = 0;
  let token;
  do {
    const res = await cognito.send(new ListUsersCommand({
      UserPoolId: POOL_ID,
      Filter: filter,
      AttributesToGet: [],
      Limit: 60,
      PaginationToken: token,
    }));
    count += res.Users?.length || 0;
    token = res.PaginationToken;
    pages++;
  } while (token && pages < MAX_PAGES);
  return { count, truncated: Boolean(token) };
}

exports.handler = async () => {
  const [unconfirmed, bcsc, pool] = await Promise.all([
    countMatching(UNCONFIRMED_FILTER),
    countMatching(BCSC_FILTER),
    cognito.send(new DescribeUserPoolCommand({ UserPoolId: POOL_ID })),
  ]);
  const estimated = pool.UserPool?.EstimatedNumberOfUsers ?? 0;
  // Floored: the estimate lags the scans, so the subtraction can go negative
  // for a few minutes after a burst of signups.
  const nativeConfirmed = Math.max(estimated - bcsc.count - unconfirmed.count, 0);
  const truncated = unconfirmed.truncated || bcsc.truncated;

  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: NAMESPACE,
    MetricData: [
      { MetricName: 'unconfirmed_users', Value: unconfirmed.count, Unit: 'Count' },
      { MetricName: 'estimated_users', Value: estimated, Unit: 'Count' },
      { MetricName: 'bcsc_users', Value: bcsc.count, Unit: 'Count' },
      { MetricName: 'native_confirmed_users', Value: nativeConfirmed, Unit: 'Count' },
    ],
  }));
  logger.info('event=user_status_counted', {
    unconfirmed: unconfirmed.count, bcsc: bcsc.count, nativeConfirmed, estimated, truncated,
  });
  return {
    unconfirmed: unconfirmed.count, bcsc: bcsc.count, nativeConfirmed, estimated, truncated,
  };
};
