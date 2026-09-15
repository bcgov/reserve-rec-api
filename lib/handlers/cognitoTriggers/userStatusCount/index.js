const { logger } = require('/opt/base');
const { CognitoIdentityProviderClient, ListUsersCommand, DescribeUserPoolCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');

/**
 * Scheduled: publish how many pool users are unconfirmed, and how many exist.
 *
 * Unconfirmed accounts are a stock, not a flow, so this is a gauge written
 * directly rather than an event= line summed by a metric filter. Signups
 * that never confirm are the shape a bot leaves, and the number rising on
 * its own is the signal.
 *
 * ListUsers is paged at 60 and the filtered scan reads every unconfirmed
 * user, so the walk is capped; past the cap the count is a floor and the
 * metric says so. The total comes from DescribeUserPool's estimate, which
 * is free and updated daily.
 */
const POOL_ID = process.env.PUBLIC_USER_POOL_ID;
const NAMESPACE = process.env.METRIC_NAMESPACE;
const MAX_PAGES = Number(process.env.MAX_PAGES || 50);

const cognito = new CognitoIdentityProviderClient({});
const cloudwatch = new CloudWatchClient({});

async function countUnconfirmed() {
  let count = 0;
  let pages = 0;
  let token;
  do {
    const res = await cognito.send(new ListUsersCommand({
      UserPoolId: POOL_ID,
      Filter: 'cognito:user_status = "UNCONFIRMED"',
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
  const [{ count, truncated }, pool] = await Promise.all([
    countUnconfirmed(),
    cognito.send(new DescribeUserPoolCommand({ UserPoolId: POOL_ID })),
  ]);
  const estimated = pool.UserPool?.EstimatedNumberOfUsers ?? 0;

  await cloudwatch.send(new PutMetricDataCommand({
    Namespace: NAMESPACE,
    MetricData: [
      { MetricName: 'unconfirmed_users', Value: count, Unit: 'Count' },
      { MetricName: 'estimated_users', Value: estimated, Unit: 'Count' },
    ],
  }));
  logger.info('event=user_status_counted', { unconfirmed: count, estimated, truncated });
  return { unconfirmed: count, estimated, truncated };
};
