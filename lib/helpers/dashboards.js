const { Duration } = require('aws-cdk-lib');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const { EVENT_GROUPS, GAUGES, alarmName } = require('./event-metrics');

// The operations pages, one dashboard each per environment, defined here so
// they are reviewed like code and cannot rot unnoticed the way hand-made
// ones did. The event metrics they read are defined in event-metrics.js.
//
//   overview   the API as a whole, every Lambda, the alarms
//   bookings   the booking routes, their events, inventory
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

const EVENT_LABELS = {
  email_change_refused: 'email_change_refused (detection only, flag off)',
  signup_phone_refused: 'signup_phone_refused (subset of signup_refused)',
};

const eventMetric = (namespace, name) => new cloudwatch.Metric({
  namespace, metricName: name, statistic: 'Sum', period: PERIOD, label: EVENT_LABELS[name] || name,
});

const API_SERIES = { '4XXError': '4XX', '5XXError': '5XX', Count: 'requests' };

/** AWS/ApiGateway, for the whole API or one method on one resource. */
function apiMetric(api, metricName, statistic, route) {
  const dimensionsMap = { ApiName: api.name };
  if (route) Object.assign(dimensionsMap, { Stage: api.stage, Method: route.method, Resource: route.resource });
  const series = API_SERIES[metricName] || `${metricName} ${statistic}`;
  return new cloudwatch.Metric({
    namespace: 'AWS/ApiGateway', metricName, statistic, period: PERIOD, dimensionsMap,
    label: route ? `${route.method} ${route.resource} ${series}` : series,
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

const eventMetrics = (namespace, names) => Object.fromEntries(names.map((n) => [n, eventMetric(namespace, n)]));
const filled = (names) => names.map((n) => `FILL(${n}, 0)`);

/** `total` less the named events. */
const lessEvents = (namespace, total, totalId, names, label) => new cloudwatch.MathExpression({
  expression: [totalId, ...filled(names)].join(' - '),
  usingMetrics: { [totalId]: total, ...eventMetrics(namespace, names) },
  label,
  period: PERIOD,
});

const sumOfEvents = (namespace, names, label) => new cloudwatch.MathExpression({
  expression: filled(names).join(' + '),
  usingMetrics: eventMetrics(namespace, names),
  label,
  period: PERIOD,
});

const BOOKING_REFUSALS = EVENT_GROUPS.bookings.filter((n) => n.includes('_refused_'));

const bookingRoute = (method, resource, name, answered = []) => {
  const refusals = name ? BOOKING_REFUSALS.filter((n) => n.startsWith(`${name}_refused_`)) : [];
  return { method, resource, name, refusals, expected4xx: [...refusals, ...answered] };
};
const BOOKING_ROUTES = [
  bookingRoute('POST', '/bookings', 'hold', ['hold_conflict']),
  bookingRoute('POST', '/bookings/{bookingId}/complete', 'complete'),
  bookingRoute('POST', '/bookings/{bookingId}/cancel', 'cancel'),
  bookingRoute('GET', '/bookings'),
  bookingRoute('GET', '/bookings/{bookingId}'),
];
const EXPECTED_4XX = BOOKING_ROUTES.flatMap((r) => r.expected4xx);

const INVENTORY_RETURN_DLQ_ALARM = 'inventory-return-dlq';

const alarmsWidget = (scope, namespace, names) => new cloudwatch.AlarmStatusWidget({
  title: 'Alarms',
  width: W,
  height: H,
  // By name rather than by reference: the alarms are created in other stacks
  // and a reference across them is a dependency this page should not add.
  alarms: names.map((name) => cloudwatch.Alarm.fromAlarmName(scope, `AlarmRef-${name}`, alarmName(namespace, name))),
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
          lessEvents(namespace, apiMetric(api, '4XXError', 'Sum'), 'total', EXPECTED_4XX, 'unexplained 4XX'),
          apiMetric(api, '5XXError', 'Sum'),
        ]),
      ],
      [
        graph('API latency (ms)', [
          apiMetric(api, 'Latency', 'p50'), apiMetric(api, 'Latency', 'p99'),
          apiMetric(api, 'IntegrationLatency', 'p99'),
        ]),
        new cloudwatch.LogQueryWidget({
          title: 'API 4XX by route, status and message (access log)',
          logGroupNames: [`/aws/apigateway/${namespace.replace('/', '-')}-public-access`],
          view: cloudwatch.LogQueryVisualizationType.TABLE,
          queryLines: [
            'filter status like /^4/',
            'stats count(*) as requests by httpMethod, resourcePath, status, errorMessage',
            'sort requests desc',
            'limit 50',
          ],
          width: W,
          height: H,
        }),
      ],
      [
        graph('Lambda errors and throttles, every function including background jobs', [
          lambdaSearch(lambdaPrefix, 'Errors', 'Sum', 'errors', preSignUpFunctionName),
          preSignUpFaults,
          lambdaSearch(lambdaPrefix, 'Throttles', 'Sum', 'throttles'),
        ]),
        graph('Lambda duration p95 (ms), every function', [lambdaSearch(lambdaPrefix, 'Duration', 'p95', 'p95')]),
      ],
      [
        graph('What happened', [
          eventMetric(namespace, 'hold_created'), eventMetric(namespace, 'booking_completed'),
          eventMetric(namespace, 'account_confirmed'),
        ]),
        graph('Refusals', [
          ...BOOKING_ROUTES.filter((r) => r.refusals.length)
            .map((r) => sumOfEvents(namespace, r.refusals, `${r.name} refusals`)),
          eventMetric(namespace, 'signup_refused'),
          eventMetric(namespace, 'email_change_refused'),
        ]),
      ],
      [alarmsWidget(scope, namespace, [...alarmNames, INVENTORY_RETURN_DLQ_ALARM])],
    ],
  });
}

function addBookingsDashboard(scope, id, namespace, api) {
  const perRoute = (metricName, statistic) => BOOKING_ROUTES.map((r) => apiMetric(api, metricName, statistic, r));
  // Inventory is published per activity and product (lib/handlers/inventoryMetrics);
  // a search follows whatever pools exist rather than naming them.
  const inventory = (metricName, window) => new cloudwatch.MathExpression({
    expression: `SEARCH('{${namespace},Activity,Product,Window} MetricName="${metricName}" Window="${window}"', 'Maximum', 300)`,
    label: `${metricName} ${window}`,
    period: PERIOD,
    usingMetrics: {},
  });
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-bookings`,
    widgets: [
      [
        graph('Booking outcomes', EVENT_GROUPS.bookings.filter((n) => !BOOKING_REFUSALS.includes(n))
          .map((n) => eventMetric(namespace, n))),
        graph('Booking refusals', BOOKING_REFUSALS.map((n) => eventMetric(namespace, n))),
      ],
      [
        graph('Booking routes: requests', perRoute('Count', 'Sum')),
        graph('Booking routes: errors', [
          ...BOOKING_ROUTES.map((r) => {
            const metric = apiMetric(api, '4XXError', 'Sum', r);
            return r.expected4xx.length
              ? lessEvents(namespace, metric, `${r.name}Total`, r.expected4xx, `${metric.label} unexplained`)
              : metric;
          }),
          ...perRoute('5XXError', 'Sum'),
        ]),
      ],
      [
        graph('Booking routes: latency p99 (ms)', perRoute('Latency', 'p99')),
        graph('Depletion (available per 5 min, today)', [new cloudwatch.MathExpression({
          expression: `RATE(SEARCH('{${namespace},Activity,Product,Window} MetricName="inventory_available" Window="today"', 'Maximum', 300)) * 300`,
          label: 'change per 5 min',
          period: PERIOD,
          usingMetrics: {},
        })]),
      ],
      [
        graph('Inventory available today, by product', [inventory('inventory_available', 'today')]),
        graph('Inventory available today and the next 7 days (8 dates), by product',
          [inventory('inventory_available', 'week')]),
      ],
    ],
  });
}

/**
 * @param {{ userPoolId: string, userPoolClientId: string }} pool
 */
function addAccountsDashboard(scope, id, namespace, pool) {
  const cognito = (metricName, extraDimensions = {}, label = metricName) => new cloudwatch.Metric({
    namespace: 'AWS/Cognito', metricName, statistic: 'Sum', period: PERIOD, label,
    dimensionsMap: { UserPool: pool.userPoolId, UserPoolClient: pool.userPoolClientId, ...extraDimensions },
  });
  const gauge = (name) => new cloudwatch.Metric({ namespace, metricName: name, statistic: 'Maximum', period: Duration.hours(1) });
  const events = (names) => names.map((n) => eventMetric(namespace, n));
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-accounts`,
    widgets: [
      [
        graph('Cognito: sign-ups and sign-ins', [
          cognito('SignUpSuccesses'),
          cognito('SignInSuccesses'),
          cognito('FederationSuccesses', { IdentityProvider: 'BCSC' }, 'BCSC FederationSuccesses'),
          cognito('TokenRefreshSuccesses'),
        ]),
        graph('Signup events', events(EVENT_GROUPS.signup)),
      ],
      [
        graph('Users', GAUGES.map(gauge)),
        graph('Email change', events(EVENT_GROUPS.emailChange)),
      ],
      [graph('Audit', events(EVENT_GROUPS.audit))],
    ],
  });
}

module.exports = { addOverviewDashboard, addBookingsDashboard, addAccountsDashboard };
