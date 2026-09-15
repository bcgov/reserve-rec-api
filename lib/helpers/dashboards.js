const { Duration } = require('aws-cdk-lib');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const { EVENT_GROUPS, GAUGES } = require('./event-metrics');

// The operations pages, one dashboard each per environment, defined here so
// they are reviewed like code and cannot rot unnoticed the way hand-made
// ones did. `ReserveRecApi-<env>-events` (event-metrics.js) is the fifth.
//
//   overview   the API as a whole, Lambda health, the alarms
//   bookings   the booking routes and the events behind them
//   accounts   the pool: Cognito's own counters beside the trigger events
//
// The edge page reads the WAF log in us-east-1 and lives with the WAF, in
// reserve-rec-public's autoblock stack.

const PERIOD = Duration.minutes(5);
const W = 12;
const H = 6;

const eventMetric = (namespace, name, label) => new cloudwatch.Metric({
  namespace, metricName: name, statistic: 'Sum', period: PERIOD, label: label || name,
});

/** AWS/ApiGateway, for the whole API or one method on one resource. */
function apiMetric(api, metricName, statistic, route) {
  const dimensionsMap = { ApiName: api.name };
  if (route) Object.assign(dimensionsMap, { Stage: api.stage, Method: route.method, Resource: route.resource });
  return new cloudwatch.Metric({
    namespace: 'AWS/ApiGateway', metricName, statistic, period: PERIOD, dimensionsMap,
    label: route ? `${route.method} ${route.resource}` : metricName,
  });
}

/**
 * Every Lambda whose name carries this environment's prefix, so the widget
 * follows the functions rather than listing them. A dev-account search that
 * did not carry the prefix would mix in every sandbox.
 */
const lambdaSearch = (prefix, metricName, statistic, label) => new cloudwatch.MathExpression({
  expression: `SEARCH('{AWS/Lambda,FunctionName} MetricName="${metricName}" ${prefix}', '${statistic}', 300)`,
  label,
  period: PERIOD,
});

const graph = (title, left, extra = {}) => new cloudwatch.GraphWidget({ title, left, width: W, height: H, ...extra });

const alarmsWidget = (scope, namespace, names) => new cloudwatch.AlarmStatusWidget({
  title: 'Alarms',
  width: W,
  height: H,
  // By name rather than by reference: the alarms are created in two stacks
  // and a reference across them is a dependency this page should not add.
  alarms: names.map((name) => cloudwatch.Alarm.fromAlarmName(scope, `AlarmRef-${name}`,
    `${namespace.replace('/', '-')}-${name}`)),
});

/**
 * @param {{ name: string, stage: string }} api
 * @param {string} lambdaPrefix  e.g. ReserveRecApi-Dev-
 * @param {string[]} alarmNames  event names that have alarms configured
 */
function addOverviewDashboard(scope, id, namespace, api, lambdaPrefix, alarmNames) {
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-overview`,
    widgets: [
      [
        graph('API requests', [apiMetric(api, 'Count', 'Sum')]),
        graph('API errors', [apiMetric(api, '4XXError', 'Sum'), apiMetric(api, '5XXError', 'Sum')]),
      ],
      [
        graph('API latency (ms)', [
          apiMetric(api, 'Latency', 'p50'), apiMetric(api, 'Latency', 'p99'),
          apiMetric(api, 'IntegrationLatency', 'p99'),
        ]),
        graph('Lambda errors and throttles', [
          lambdaSearch(lambdaPrefix, 'Errors', 'Sum', 'errors'),
          lambdaSearch(lambdaPrefix, 'Throttles', 'Sum', 'throttles'),
        ]),
      ],
      [
        graph('Lambda duration p95 (ms)', [lambdaSearch(lambdaPrefix, 'Duration', 'p95', 'p95')]),
        graph('What happened', [
          eventMetric(namespace, 'hold_created'), eventMetric(namespace, 'booking_completed'),
          eventMetric(namespace, 'account_confirmed'), eventMetric(namespace, 'signup_refused'),
        ]),
      ],
      [alarmsWidget(scope, namespace, alarmNames)],
    ],
  });
}

const BOOKING_ROUTES = [
  { method: 'POST', resource: '/bookings' },
  { method: 'POST', resource: '/bookings/{bookingId}/complete' },
  { method: 'POST', resource: '/bookings/{bookingId}/cancel' },
  { method: 'GET', resource: '/bookings' },
];

function addBookingsDashboard(scope, id, namespace, api) {
  const perRoute = (metricName, statistic) => BOOKING_ROUTES.map((r) => apiMetric(api, metricName, statistic, r));
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-bookings`,
    widgets: [
      [
        graph('Booking events', EVENT_GROUPS.bookings.map((n) => eventMetric(namespace, n))),
        graph('Booking routes: requests', perRoute('Count', 'Sum')),
      ],
      [
        graph('Booking routes: errors', [...perRoute('4XXError', 'Sum'), ...perRoute('5XXError', 'Sum')]),
        graph('Booking routes: latency p99 (ms)', perRoute('Latency', 'p99')),
      ],
    ],
  });
}

/**
 * @param {{ userPoolId: string, userPoolClientId: string }} pool
 */
function addAccountsDashboard(scope, id, namespace, pool) {
  const cognito = (metricName) => new cloudwatch.Metric({
    namespace: 'AWS/Cognito', metricName, statistic: 'Sum', period: PERIOD,
    dimensionsMap: { UserPool: pool.userPoolId, UserPoolClient: pool.userPoolClientId },
  });
  const gauge = (name) => new cloudwatch.Metric({ namespace, metricName: name, statistic: 'Maximum', period: Duration.hours(1) });
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-accounts`,
    widgets: [
      [
        graph('Cognito: sign-ups and sign-ins', ['SignUpSuccesses', 'SignInSuccesses', 'FederationSuccesses', 'TokenRefreshSuccesses'].map(cognito)),
        graph('Signup events', EVENT_GROUPS.signup.map((n) => eventMetric(namespace, n))),
      ],
      [
        graph('Users', GAUGES.map(gauge)),
        graph('Email change', EVENT_GROUPS.emailChange.map((n) => eventMetric(namespace, n))),
      ],
      [graph('Audit', EVENT_GROUPS.audit.map((n) => eventMetric(namespace, n)))],
    ],
  });
}

module.exports = { addOverviewDashboard, addBookingsDashboard, addAccountsDashboard };
