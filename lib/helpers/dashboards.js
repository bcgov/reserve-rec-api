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

// Series colours. CloudWatch's own default palette puts orange next to red,
// which is the pair hardest to tell apart on a dark dashboard — and the two it
// hands to the third and fourth series of every widget. These are the dark-mode
// steps of a palette checked for colour-vision separation: worst adjacent pair
// deltaE 8.4 (protan), every step clears 3:1 against the dashboard surface. Red
// is deliberately last so it only appears on a widget with eight series, where
// it reads as "one more" rather than as a warning.
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9',
                '#008300', '#e66767'];

// Colour by position, so a series keeps its colour as long as the list does.
const paint = (metrics) => metrics.map((m, i) => {
  const color = SERIES[i % SERIES.length];
  if (m instanceof cloudwatch.MathExpression) {
    return new cloudwatch.MathExpression({ ...m, expression: m.expression,
      usingMetrics: m.usingMetrics, label: m.label, period: m.period, color });
  }
  return m.with({ color });
});

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
const lambdaSearch = (prefix, metricName, statistic, label, excludeFunction) => new cloudwatch.MathExpression({
  expression: `SEARCH('{AWS/Lambda,FunctionName} MetricName="${metricName}" ${prefix}${
    excludeFunction ? ` NOT FunctionName="${excludeFunction}"` : ''}', '${statistic}', 300)`,
  label,
  period: PERIOD,
});

const graph = (title, left, extra = {}) =>
  new cloudwatch.GraphWidget({ title, left: paint(left), width: W, height: H, ...extra });

// Refusals are the rules working — a duplicate pass, a blocked address — so
// they are graphed on their own and taken out of the error counts.
const HOLD_REFUSALS = ['hold_refused_has_booking', 'hold_refused_has_hold'];
const REFUSALS = [
  ...HOLD_REFUSALS, 'booking_refused_unverified_email',
  'signup_refused', 'signup_phone_refused', 'email_change_refused',
];

/** `total` less the hold refusals, which API Gateway counts as 4XX. */
const lessHoldRefusals = (namespace, total, label) => new cloudwatch.MathExpression({
  expression: `total - ${HOLD_REFUSALS.map((_, i) => `FILL(r${i}, 0)`).join(' - ')}`,
  usingMetrics: {
    total,
    ...Object.fromEntries(HOLD_REFUSALS.map((n, i) => [`r${i}`, eventMetric(namespace, n)])),
  },
  label,
  period: PERIOD,
});

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
 * @param {string} preSignUpFunctionName  its errors are mostly refusals, graphed apart
 */
function addOverviewDashboard(scope, id, namespace, api, lambdaPrefix, alarmNames, preSignUpFunctionName) {
  // PreSignUp refuses an address by throwing, so Lambda counts every refusal
  // as an error. What is left after the refusals is a real fault.
  const preSignUpFaults = new cloudwatch.MathExpression({
    expression: 'FILL(errors, 0) - FILL(refused, 0)',
    usingMetrics: {
      errors: new cloudwatch.Metric({
        namespace: 'AWS/Lambda', metricName: 'Errors', statistic: 'Sum', period: PERIOD,
        dimensionsMap: { FunctionName: preSignUpFunctionName },
      }),
      refused: eventMetric(namespace, 'signup_refused'),
    },
    label: 'PreSignUp errors that were not refusals',
    period: PERIOD,
  });
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-overview`,
    widgets: [
      [
        graph('API requests', [apiMetric(api, 'Count', 'Sum')]),
        graph('API errors', [
          lessHoldRefusals(namespace, apiMetric(api, '4XXError', 'Sum'), '4XXError less refusals'),
          apiMetric(api, '5XXError', 'Sum'),
        ]),
      ],
      [
        graph('API latency (ms)', [
          apiMetric(api, 'Latency', 'p50'), apiMetric(api, 'Latency', 'p99'),
          apiMetric(api, 'IntegrationLatency', 'p99'),
        ]),
        graph('Lambda errors and throttles', [
          lambdaSearch(lambdaPrefix, 'Errors', 'Sum', 'errors', preSignUpFunctionName),
          preSignUpFaults,
          lambdaSearch(lambdaPrefix, 'Throttles', 'Sum', 'throttles'),
        ]),
      ],
      [
        graph('Lambda duration p95 (ms)', [lambdaSearch(lambdaPrefix, 'Duration', 'p95', 'p95')]),
        graph('What happened', [
          eventMetric(namespace, 'hold_created'), eventMetric(namespace, 'booking_completed'),
          eventMetric(namespace, 'account_confirmed'),
        ]),
      ],
      [
        graph('Refusals', REFUSALS.map((n) => eventMetric(namespace, n))),
        // CloudWatch rejects an alarm widget that lists no alarms.
        ...(alarmNames.length ? [alarmsWidget(scope, namespace, alarmNames)] : []),
      ],
    ],
  });
}

const CREATE_ROUTE = { method: 'POST', resource: '/bookings' };
const BOOKING_ROUTES = [
  CREATE_ROUTE,
  { method: 'POST', resource: '/bookings/{bookingId}/complete' },
  { method: 'POST', resource: '/bookings/{bookingId}/cancel' },
  { method: 'GET', resource: '/bookings' },
];

function addBookingsDashboard(scope, id, namespace, api) {
  const perRoute = (metricName, statistic) => BOOKING_ROUTES.map((r) => apiMetric(api, metricName, statistic, r));
  // Inventory is published per activity and product (lib/handlers/inventoryMetrics);
  // a search follows whatever pools exist rather than naming them.
  const inventory = (metricName, window, id) => new cloudwatch.MathExpression({
    expression: `SEARCH('{${namespace},Activity,Product,Window} MetricName="${metricName}" Window="${window}"', 'Maximum', 300)`,
    label: `${metricName} ${window}`,
    period: PERIOD,
    usingMetrics: {},
  });
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-bookings`,
    widgets: [
      [
        graph('Booking events', EVENT_GROUPS.bookings.map((n) => eventMetric(namespace, n))),
        graph('Booking routes: requests', perRoute('Count', 'Sum')),
      ],
      [
        graph('Booking routes: errors', [
          ...BOOKING_ROUTES.map((r) => {
            const metric = apiMetric(api, '4XXError', 'Sum', r);
            return r === CREATE_ROUTE ? lessHoldRefusals(namespace, metric, `${metric.label} less refusals`) : metric;
          }),
          ...perRoute('5XXError', 'Sum'),
        ]),
        graph('Booking routes: latency p99 (ms)', perRoute('Latency', 'p99')),
      ],
      [
        graph('Inventory available today, by product', [inventory('inventory_available', 'today')]),
        graph('Inventory available next 7 days, by product', [inventory('inventory_available', 'week')]),
      ],
      [
        graph('Depletion (available per 5 min, today)', [new cloudwatch.MathExpression({
          expression: `RATE(SEARCH('{${namespace},Activity,Product,Window} MetricName="inventory_available" Window="today"', 'Maximum', 300)) * 300`,
          label: 'change per 5 min',
          period: PERIOD,
          usingMetrics: {},
        })]),
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
