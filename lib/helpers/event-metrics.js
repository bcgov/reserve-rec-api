const { Duration } = require('aws-cdk-lib');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const logs = require('aws-cdk-lib/aws-logs');

// Handlers log operational events as `event=<name>` — the first token of the
// message, followed by JSON metadata (see the base layer logger). Each name
// below becomes a CloudWatch metric of the same name in the
// `ReserveRecApi/<env>` namespace, fed by a metric filter on the emitting
// Lambda's log group.
//
// bookings
//   hold_created                     a hold was placed
//   hold_failed                      the hold threw
//   booking_completed                a hold became a booking
//   booking_complete_failed          completion threw
//   booking_refused_unverified_email booking refused: the account's email is unverified
// signup
//   signup_refused                   PreSignUp refused the address
//   account_created                  first login created the user record
// email change (PreTokenGeneration / CustomMessage)
//   email_changed                    address on the token differs from the stored record
//   email_change_refused             the new address failed the blocklist check
//   email_change_observed            CustomMessage saw an email change start
//   email_change_vetoed              CustomMessage stopped a self-service email change
// audit (CognitoAudit, from CloudTrail)
//   email_change_requested           UpdateUserAttributes carrying a new email
//   email_change_request_failed      that call errored
//   email_change_verified            the new address was verified
//   attribute_verified               VerifyUserAttribute with the attribute name redacted
//   admin_attributes_updated         an IAM principal wrote pool attributes
//   attributes_deleted               attributes removed from a user
const EVENT_GROUPS = {
  bookings: [
    'hold_created',
    'hold_failed',
    'booking_completed',
    'booking_complete_failed',
    'booking_refused_unverified_email',
  ],
  signup: ['signup_refused', 'account_created'],
  emailChange: [
    'email_changed',
    'email_change_refused',
    'email_change_observed',
    'email_change_vetoed',
  ],
  audit: [
    'email_change_requested',
    'email_change_request_failed',
    'email_change_verified',
    'attribute_verified',
    'admin_attributes_updated',
    'attributes_deleted',
  ],
};

const KNOWN_EVENTS = new Set(Object.values(EVENT_GROUPS).flat());
const PERIOD = Duration.minutes(5);

const eventMetricNamespace = (deploymentName) => `ReserveRecApi/${deploymentName}`;

const eventMetric = (namespace, name) => new cloudwatch.Metric({
  namespace,
  metricName: name,
  statistic: 'Sum',
  period: PERIOD,
});

/**
 * One metric filter per event name on the Lambda's log group. `alarms` is the
 * stack's `eventAlarms` config (event name -> count per 5 minutes that trips
 * it); an alarm is created for each entry naming one of `eventNames`.
 *
 * The function must be created with `logRetention` set: `fn.logGroup` on a
 * function without it attaches a LogRetention resource that removes the log
 * group's existing retention policy. (`logRetention` is deprecated in favour
 * of `logGroup`, but that declares a LogGroup resource, which fails where
 * Lambda has already created the group.)
 */
function addEventMetrics(fn, namespace, eventNames, alarms = {}) {
  if (!fn.node.children.some((child) => child instanceof logs.LogRetention)) {
    throw new Error(`${fn.node.path}: set logRetention before adding event metrics`);
  }
  for (const name of eventNames) {
    if (!KNOWN_EVENTS.has(name)) {
      throw new Error(`${fn.node.path}: unknown event "${name}", add it to EVENT_GROUPS`);
    }
    // A quoted term matches as a substring, so a name that prefixes another
    // would count both.
    const shadowed = eventNames.find((other) => other !== name && other.startsWith(name));
    if (shadowed) {
      throw new Error(`${fn.node.path}: event "${name}" would also match "${shadowed}"`);
    }
    new logs.MetricFilter(fn, `EventMetric-${name}`, {
      logGroup: fn.logGroup,
      filterPattern: logs.FilterPattern.literal(`"event=${name}"`),
      metricNamespace: namespace,
      metricName: name,
      metricValue: '1',
      defaultValue: 0,
      unit: cloudwatch.Unit.COUNT,
    });
  }
  for (const name of eventNames.filter((name) => alarms[name] !== undefined)) {
    const threshold = Number(alarms[name]);
    if (!(threshold > 0)) {
      throw new Error(`${fn.node.path}: eventAlarms.${name} must be a positive count`);
    }
    eventMetric(namespace, name).createAlarm(fn, `EventAlarm-${name}`, {
      alarmName: `${namespace.replace('/', '-')}-${name}`,
      alarmDescription: `${name} logged ${threshold} or more times in 5 minutes`,
      threshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}

/** One dashboard per environment: a graph per group. */
function addEventDashboard(scope, id, namespace) {
  const graph = (title, names) => new cloudwatch.GraphWidget({
    title,
    left: names.map((name) => eventMetric(namespace, name)),
    width: 12,
    height: 6,
  });
  return new cloudwatch.Dashboard(scope, id, {
    dashboardName: `${namespace.replace('/', '-')}-events`,
    widgets: [
      [graph('Bookings', EVENT_GROUPS.bookings), graph('Signup', EVENT_GROUPS.signup)],
      [graph('Email change', EVENT_GROUPS.emailChange), graph('Audit', EVENT_GROUPS.audit)],
    ],
  });
}

module.exports = {
  EVENT_GROUPS,
  eventMetricNamespace,
  addEventMetrics,
  addEventDashboard,
};
