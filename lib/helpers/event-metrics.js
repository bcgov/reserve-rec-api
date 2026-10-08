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
//   hold_failed                      the hold failed with a 5xx or an unexpected error
//   hold_conflict                    the hold lost a write race after retries, or a booking key already existed
//   hold_refused_has_booking         hold refused: the user already has this pass confirmed
//   hold_refused_has_hold            hold refused: the user already holds this pass in a cart
//   hold_refused_invalid             hold refused: missing or invalid input, a quantity or day limit, or not signed in
//   hold_refused_state               hold refused: the product or date is not reservable
//   hold_refused_not_found           hold refused: no such product, or no dates for it
//   hold_refused_window              hold refused: outside the reservation window
//   hold_refused_sold_out            hold refused: no inventory left
//   hold_refused_waiting_room        hold refused: no valid waiting-room admission
//   hold_refused_unverified_email    hold refused: the account's email is unverified
//   hold_refused_cooldown            hold refused: a wait after removed holds on this pass and date
//   hold_refused_cap                 hold refused: the hold limit for this pass and date
//   hold_refused_rebook_wait         hold refused: a wait after cancelled bookings on this pass and date
//   hold_limits_config_invalid       HOLD_LIMITS could not be read; hold limits are off
//   booking_completed                a hold became a booking
//   booking_complete_failed          completion failed with a 5xx or an unexpected error
//   complete_refused_invalid         completion refused: missing or invalid input, or not signed in
//   complete_refused_not_found       completion refused: no such booking
//   complete_refused_state           completion refused: not in progress, session expired or window closed
//   complete_refused_owner           completion refused: another account's booking or session
//   complete_refused_unverified_email completion refused: the account's email is unverified
//   cancel_refused_state             cancel refused: already cancelled, checked in, past checkout or not cancellable
//   cancel_refused_owner             cancel refused: another account's booking
//   cancel_refused_invalid           cancel refused: missing or invalid input, or not signed in
//   cancel_refused_not_found         cancel refused: no such booking
//   cancel_failed                    cancel failed with a 5xx or an unexpected error
// signup
//   signup_refused                   PreSignUp refused the address
//   signup_phone_refused             PreSignUp refused an unreachable phone number
//   account_confirmed                PostConfirmation: a signup was confirmed
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
    'hold_conflict',
    'hold_refused_has_booking',
    'hold_refused_has_hold',
    'hold_refused_invalid',
    'hold_refused_state',
    'hold_refused_not_found',
    'hold_refused_window',
    'hold_refused_sold_out',
    'hold_refused_waiting_room',
    'hold_refused_unverified_email',
    'hold_refused_cooldown',
    'hold_refused_cap',
    'hold_refused_rebook_wait',
    'hold_limits_config_invalid',
    'booking_completed',
    'booking_complete_failed',
    'complete_refused_invalid',
    'complete_refused_not_found',
    'complete_refused_state',
    'complete_refused_owner',
    'complete_refused_unverified_email',
    'cancel_refused_state',
    'cancel_refused_owner',
    'cancel_refused_invalid',
    'cancel_refused_not_found',
    'cancel_failed',
  ],
  signup: [
    'signup_refused', 'signup_phone_refused', 'signup_flagged',
    'account_confirmed', 'account_created', 'account_flagged',
  ],
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

// Gauges are written with PutMetricData by a scheduled function rather than
// summed from log lines: a stock, read hourly, that a filter would show as
// zero between readings.
//   estimated_users                  the pool's own user count estimate — the total
//   bcsc_users                       federated BCSC accounts
//   native_confirmed_users           non-BCSC accounts that confirmed (derived: total - bcsc - unconfirmed)
//   unconfirmed_users                non-BCSC accounts that signed up and never confirmed
const GAUGES = ['estimated_users', 'native_confirmed_users', 'unconfirmed_users', 'bcsc_users'];

// Alarms created wherever the event is wired, unless `eventAlarms` sets its own threshold.
const DEFAULT_EVENT_ALARMS = { hold_limits_config_invalid: 1 };

const KNOWN_EVENTS = new Set(Object.values(EVENT_GROUPS).flat());
const PERIOD = Duration.minutes(5);

const eventMetricNamespace = (deploymentName) => `ReserveRecApi/${deploymentName}`;

const alarmName = (namespace, name) => `${namespace.replace('/', '-')}-${name}`;

const eventMetric = (namespace, name) => new cloudwatch.Metric({
  namespace,
  metricName: name,
  statistic: 'Sum',
  period: PERIOD,
});

/**
 * One metric filter per event name on the Lambda's log group. `configuredAlarms`
 * is the stack's `eventAlarms` config (event name -> count per 5 minutes that trips
 * it), over DEFAULT_EVENT_ALARMS; an alarm is created for each entry naming
 * one of `eventNames`.
 *
 * The function must be created with `logRetention` set: `fn.logGroup` on a
 * function without it attaches a LogRetention resource that removes the log
 * group's existing retention policy. (`logRetention` is deprecated in favour
 * of `logGroup`, but that declares a LogGroup resource, which fails where
 * Lambda has already created the group.)
 */
function addEventMetrics(fn, namespace, eventNames, configuredAlarms = {}) {
  const alarms = { ...DEFAULT_EVENT_ALARMS, ...configuredAlarms };
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
      alarmName: alarmName(namespace, name),
      alarmDescription: `${name} logged ${threshold} or more times in 5 minutes`,
      threshold,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
  }
}

module.exports = {
  DEFAULT_EVENT_ALARMS,
  EVENT_GROUPS,
  GAUGES,
  eventMetricNamespace,
  alarmName,
  addEventMetrics,
};
