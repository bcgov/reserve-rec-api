'use strict';

const { App, Stack } = require('aws-cdk-lib');
const { Template } = require('aws-cdk-lib/assertions');
const lambda = require('aws-cdk-lib/aws-lambda');
const logs = require('aws-cdk-lib/aws-logs');
const { addOverviewDashboard, addBookingsDashboard, addAccountsDashboard } = require('../lib/helpers/dashboards');
const { EVENT_GROUPS, addEventMetrics } = require('../lib/helpers/event-metrics');

const NAMESPACE = 'ReserveRecApi/test';
const API = { name: 'test-public-api', stage: 'api' };

function synth(build) {
  const stack = new Stack(new App(), 'Test');
  build(stack);
  return Template.fromStack(stack);
}

const joined = (value) => {
  if (typeof value === 'string') return value;
  if (value.Ref) return `\${${value.Ref}}`;
  return value['Fn::Join'][1].map(joined).join('');
};

function dashboard(template, suffix) {
  const found = Object.values(template.findResources('AWS::CloudWatch::Dashboard'))
    .find((r) => r.Properties.DashboardName === `ReserveRecApi-test-${suffix}`);
  return JSON.parse(joined(found.Properties.DashboardBody)).widgets;
}

const widget = (widgets, title) => widgets.find((w) => w.properties.title === title).properties;
const expressions = (w) => w.metrics.map((m) => m[m.length - 1]).filter((o) => o.expression);
const labels = (w) => w.metrics.map((m) => m[m.length - 1]).filter((o) => o.visible !== false).map((o) => o.label);
const eventNames = (w) => w.metrics.filter((m) => m[0] === NAMESPACE).map((m) => m[1]);

const KNOWN = new Set(Object.values(EVENT_GROUPS).flat());
const HOLD_EXPECTED = [...EVENT_GROUPS.bookings.filter((n) => n.startsWith('hold_refused_')), 'hold_conflict'];
const COMPLETE_REFUSALS = EVENT_GROUPS.bookings.filter((n) => n.startsWith('complete_refused_'));
const CANCEL_REFUSALS = EVENT_GROUPS.bookings.filter((n) => n.startsWith('cancel_refused_'));

describe('overview dashboard', () => {
  const widgets = dashboard(synth((stack) => addOverviewDashboard(stack, 'Overview', NAMESPACE, API,
    'ReserveRecApi-test-', ['hold_failed'], 'ReserveRecApi-test-PreSignUp')), 'overview');

  it('takes every logged 4XX answer out of the API 4XX count', () => {
    const [unexplained] = expressions(widget(widgets, 'API errors'));
    expect(unexplained.label).toBe('unexplained 4XX');
    expect(unexplained.expression).toBe(
      ['total', ...[...HOLD_EXPECTED, ...COMPLETE_REFUSALS, ...CANCEL_REFUSALS].map((n) => `FILL(${n}, 0)`)].join(' - '));
  });

  it('tables 4XX from the access log by route, status and message', () => {
    const table = widget(widgets, 'API 4XX by route, status and message (access log)');
    expect(table.query).toContain("SOURCE '/aws/apigateway/ReserveRecApi-test-public-access'");
    expect(table.query).toContain('stats count(*) as requests by httpMethod, resourcePath, status, errorMessage');
    expect(table.view).toBe('table');
  });

  it('labels latency by statistic', () => {
    expect(labels(widget(widgets, 'API latency (ms)'))).toEqual(['Latency p50', 'Latency p99', 'IntegrationLatency p99']);
  });

  it('sums refusals per route and leaves out the phone subset', () => {
    const refusals = widget(widgets, 'Refusals');
    expect(labels(refusals)).toEqual(['hold refusals', 'complete refusals', 'cancel refusals', 'signup_refused',
      'email_change_refused (detection only, flag off)']);
    expect(eventNames(refusals)).not.toContain('signup_phone_refused');
  });

  it('counts every refusal each route logs', () => {
    expect(HOLD_EXPECTED).toEqual([
      'hold_refused_has_booking', 'hold_refused_has_hold', 'hold_refused_invalid', 'hold_refused_state',
      'hold_refused_not_found', 'hold_refused_window', 'hold_refused_sold_out', 'hold_refused_waiting_room',
      'hold_refused_unverified_email', 'hold_refused_cooldown', 'hold_refused_cap', 'hold_conflict',
    ]);
    expect(COMPLETE_REFUSALS).toEqual(['complete_refused_invalid', 'complete_refused_not_found',
      'complete_refused_state', 'complete_refused_owner', 'complete_refused_unverified_email']);
    expect(CANCEL_REFUSALS).toEqual(['cancel_refused_state', 'cancel_refused_owner', 'cancel_refused_invalid',
      'cancel_refused_not_found']);
    const byLabel = Object.fromEntries(expressions(widget(widgets, 'Refusals')).map((e) => [e.label, e.expression]));
    expect(byLabel).toEqual({
      'hold refusals': HOLD_EXPECTED.filter((n) => n !== 'hold_conflict').map((n) => `FILL(${n}, 0)`).join(' + '),
      'complete refusals': COMPLETE_REFUSALS.map((n) => `FILL(${n}, 0)`).join(' + '),
      'cancel refusals': CANCEL_REFUSALS.map((n) => `FILL(${n}, 0)`).join(' + '),
    });
  });

  it('lists the event alarms and the inventory-return DLQ alarm', () => {
    const alarms = widgets.find((w) => w.type === 'alarm').properties.alarms.map(joined);
    expect(alarms).toEqual([
      expect.stringMatching(/:alarm:ReserveRecApi-test-hold_failed$/),
      expect.stringMatching(/:alarm:ReserveRecApi-test-inventory-return-dlq$/),
    ]);
  });

  it('says the Lambda widget covers every function', () => {
    expect(widget(widgets, 'Lambda errors and throttles, every function including background jobs')).toBeDefined();
  });

  it('reads only known events', () => {
    widgets.filter((w) => w.properties.metrics).forEach((w) =>
      eventNames(w.properties).forEach((n) => expect(KNOWN).toContain(n)));
  });
});

describe('bookings dashboard', () => {
  const widgets = dashboard(synth((stack) => addBookingsDashboard(stack, 'Bookings', NAMESPACE, API)), 'bookings');

  it('takes each route its own refusals out of its 4XX count', () => {
    const errors = widget(widgets, 'Booking routes: errors');
    const byLabel = Object.fromEntries(expressions(errors).map((e) => [e.label, e.expression]));
    expect(byLabel).toEqual({
      'POST /bookings 4XX unexplained': ['holdTotal', ...HOLD_EXPECTED.map((n) => `FILL(${n}, 0)`)].join(' - '),
      'POST /bookings/{bookingId}/complete 4XX unexplained':
        ['completeTotal', ...COMPLETE_REFUSALS.map((n) => `FILL(${n}, 0)`)].join(' - '),
      'POST /bookings/{bookingId}/cancel 4XX unexplained':
        ['cancelTotal', ...CANCEL_REFUSALS.map((n) => `FILL(${n}, 0)`)].join(' - '),
    });
    expect(labels(errors)).toEqual(expect.arrayContaining([
      'GET /bookings 4XX', 'GET /bookings/{bookingId} 4XX', 'POST /bookings 5XX', 'GET /bookings/{bookingId} 5XX',
    ]));
  });

  it('graphs GET /bookings/{bookingId}', () => {
    expect(labels(widget(widgets, 'Booking routes: requests'))).toContain('GET /bookings/{bookingId} requests');
    expect(labels(widget(widgets, 'Booking routes: latency p99 (ms)'))).toContain('GET /bookings/{bookingId} Latency p99');
  });

  it('names the inventory window by its dates', () => {
    expect(widget(widgets, 'Inventory available today and the next 7 days (8 dates), by product')).toBeDefined();
  });

  it('graphs every booking event once', () => {
    const graphed = [...eventNames(widget(widgets, 'Booking outcomes')), ...eventNames(widget(widgets, 'Booking refusals'))];
    expect(graphed.sort()).toEqual([...EVENT_GROUPS.bookings].sort());
  });
});

describe('accounts dashboard', () => {
  const widgets = dashboard(synth((stack) => addAccountsDashboard(stack, 'Accounts', NAMESPACE,
    { userPoolId: 'pool', userPoolClientId: 'client' })), 'accounts');

  it('reads BCSC federation by identity provider', () => {
    const federation = widget(widgets, 'Cognito: sign-ups and sign-ins').metrics
      .find((m) => m[1] === 'FederationSuccesses');
    expect(federation).toEqual(expect.arrayContaining(['IdentityProvider', 'BCSC']));
    expect(federation[federation.length - 1].label).toBe('BCSC FederationSuccesses');
  });

  it('labels the phone refusal as a subset and the email change refusal as detection only', () => {
    expect(labels(widget(widgets, 'Signup events'))).toContain('signup_phone_refused (subset of signup_refused)');
    expect(labels(widget(widgets, 'Email change'))).toContain('email_change_refused (detection only, flag off)');
  });
});

describe('addEventMetrics', () => {
  it('adds one filter per event on the function log group', () => {
    const template = synth((stack) => {
      const fn = new lambda.Function(stack, 'Cancel', {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline('exports.handler = async () => {};'),
        logRetention: logs.RetentionDays.ONE_DAY,
      });
      addEventMetrics(fn, NAMESPACE, ['cancel_refused_state', 'cancel_failed']);
    });
    const filters = Object.values(template.findResources('AWS::Logs::MetricFilter')).map((r) => r.Properties);
    expect(filters.map((f) => [f.FilterPattern, f.MetricTransformations[0].MetricName])).toEqual([
      ['"event=cancel_refused_state"', 'cancel_refused_state'],
      ['"event=cancel_failed"', 'cancel_failed'],
    ]);
  });
});
