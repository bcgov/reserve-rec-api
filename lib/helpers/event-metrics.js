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
//   hold_refused_hold_gate           hold refused: the account's review state is pending or rejected
//   hold_limits_config_invalid       HOLD_LIMITS could not be read; hold limits are off
//   booking_completed                a hold became a booking
//   booking_complete_failed          completion failed with a 5xx or an unexpected error
//   complete_refused_invalid         completion refused: missing or invalid input, or not signed in
//   complete_refused_not_found       completion refused: no such booking
//   complete_refused_state           completion refused: not in progress, session expired or window closed
//   complete_refused_owner           completion refused: another account's booking or session
//   complete_refused_unverified_email completion refused: the account's email is unverified
//   complete_refused_hold_gate       completion refused: the account's review state is pending or rejected
//   confirmation_email_unsent        a booking completed but its confirmation email was not queued
//   cancel_refused_state             cancel refused: already cancelled, checked in, past checkout or not cancellable
//   cancel_refused_owner             cancel refused: another account's booking
//   cancel_refused_invalid           cancel refused: missing or invalid input, or not signed in
//   cancel_refused_not_found         cancel refused: no such booking
//   cancel_failed                    cancel failed with a 5xx or an unexpected error
//   remove_refused_state             remove refused: already removed, checked in, past checkout or not removable
//   remove_refused_owner             remove refused: another account's booking
//   remove_refused_invalid           remove refused: missing or invalid input, or not signed in
//   remove_refused_not_found         remove refused: no such booking
//   remove_failed                    remove failed with a 5xx or an unexpected error
//
// payments (transactions POST and the admin reconcile route)
//   payment_reconciled               a stuck payment was checked against Worldline; `outcome` says what was found
//   payment_voided                   a charge whose booking could not be confirmed was voided
//   payment_void_failed              that void was refused or got no answer; the card stays charged
//   payment_record_failed            a payment outcome could not be written to the attempt and lock
//   payment_unconfirmed              no answer from Worldline; the card may have been charged
//   payment_booking_completion_failed the card was charged but the booking could not be confirmed
//   payment_duplicate_refused        a payment was refused because the booking is paid or a payment is in flight
//   payment_attempts_exhausted       a payment was refused because the booking used all its attempts
//   payment_reconcile_requested      an admin ran the reconcile route on a booking
//   payment_reconcile_not_found      the reconcile route found no payment for the booking
//   payment_settled_manually         an admin marked a stuck payment failed or paid by hand
//
// signup
//   signup_refused                   PreSignUp refused the address
//   signup_phone_refused             PreSignUp refused an unreachable phone number
//   account_confirmed                PostConfirmation: a signup was confirmed
//   account_created                  first login created the user record
// migration
//   migration_processing             a confirmed account migration started
//   migration_completed              data transfer and old-account removal succeeded
//   migration_pending_attribute_synced PostAuthentication copied the pending flag to Cognito
// email change (PreTokenGeneration / CustomMessage)
//   email_changed                    address on the token differs from the stored record
//   email_change_refused             the new address failed the blocklist check
//   email_change_observed            CustomMessage saw an email change start
//   email_change_vetoed              CustomMessage stopped a self-service email change
// audit (CognitoAudit, from CloudTrail)
//   email_change_requested           UpdateUserAttributes that sent an email verification code
//   attribute_update_failed          UpdateUserAttributes errored (which attributes is not recorded)
//   email_change_verified            the new address was verified
//   attribute_verified               VerifyUserAttribute with the attribute name redacted
//   admin_attributes_updated         an IAM principal wrote pool attributes
//   attributes_deleted               attributes removed from a user
// availability (public authorizer)
//   availability_denied              a signed-in availability read was answered as a guest
//   token_network_spread             a signed-in availability read came from more networks than the limit
//   viewer_ip_missing                a signed-in availability read had no usable client IP
// admin realtime (WebSocket API and its stream publisher)
//   realtime_connected               an admin connected
//   realtime_disconnected            an admin connection closed
//   realtime_subscribe_forbidden     subscribe refused for the admin's permissions
//   realtime_message_sent            the publisher delivered one message
//   realtime_publish_failed          the publisher failed one stream record
//   realtime_send_failed             the publisher could not send to one connection
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
    'hold_refused_hold_gate',
    'hold_limits_config_invalid',
    'booking_completed',
    'booking_complete_failed',
    'complete_refused_invalid',
    'complete_refused_not_found',
    'complete_refused_state',
    'complete_refused_owner',
    'complete_refused_unverified_email',
    'complete_refused_hold_gate',
    'confirmation_email_unsent',
    'cancel_refused_state',
    'cancel_refused_owner',
    'cancel_refused_invalid',
    'cancel_refused_not_found',
    'cancel_failed',
    'remove_refused_state',
    'remove_refused_owner',
    'remove_refused_invalid',
    'remove_refused_not_found',
    'remove_failed',
  ],
  payments: [
    'payment_reconciled',
    'payment_voided',
    'payment_void_failed',
    'payment_record_failed',
    'payment_unconfirmed',
    'payment_booking_completion_failed',
    'payment_duplicate_refused',
    'payment_attempts_exhausted',
    'payment_reconcile_requested',
    'payment_reconcile_not_found',
    'payment_settled_manually',
  ],
  signup: [
    'signup_refused', 'signup_phone_refused', 'signup_flagged',
    'account_confirmed', 'account_created', 'account_flagged',
  ],
  migration: ['migration_processing', 'migration_completed', 'migration_pending_attribute_synced'],
  emailChange: [
    'email_changed',
    'email_change_refused',
    'email_change_observed',
    'email_change_vetoed',
  ],
  availability: ['availability_denied', 'token_network_spread', 'viewer_ip_missing'],
  realtime: ['realtime_connected', 'realtime_disconnected', 'realtime_subscribe_forbidden', 'realtime_message_sent', 'realtime_publish_failed', 'realtime_send_failed'],
  audit: [
    'email_change_requested',
    'attribute_update_failed',
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
const DEFAULT_EVENT_ALARMS = {
  hold_limits_config_invalid: 1,
  payment_unconfirmed: 1,
  payment_booking_completion_failed: 1,
  payment_void_failed: 1,
  payment_record_failed: 1,
};

// Old event name -> current one, so an `eventAlarms` key in SSM written before
// a rename still creates the alarm instead of being silently ignored.
const RENAMED_EVENTS = { email_change_request_failed: 'attribute_update_failed' };

// Appended to an alarm's description: what tripping it means and where to look.
const ALARM_NOTES = {
  admin_attributes_updated: 'Fires on any admin write to the public pool, including sanctioned bulk scripts and console edits. '
    + 'Check principalArn on the event=admin_attributes_updated line in the CognitoAudit log to see who made it.',
};

const KNOWN_EVENTS = new Set(Object.values(EVENT_GROUPS).flat());

/** `eventAlarms` config with renamed events under their current name; a current key wins over its old one. */
function renameLegacyEvents(alarms) {
  const renamed = {};
  for (const [name, threshold] of Object.entries(alarms || {})) {
    const current = RENAMED_EVENTS[name];
    if (!current) renamed[name] = threshold;
    else if (!(current in alarms)) renamed[current] = threshold;
  }
  return renamed;
}

const PERIOD = Duration.minutes(5);

// Retention for the log groups that carry event lines.
const EVENT_LOG_RETENTION = logs.RetentionDays.TWO_YEARS;

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
 * one of `eventNames`. Metrics carry no dimensions, so an event logged by several
 * functions is one metric; wire its alarm on one of them and pass `{ alarms: false }`
 * on the rest (alarm names are unique per account).
 *
 * The function must be created with `logRetention` set: `fn.logGroup` on a
 * function without it attaches a LogRetention resource that removes the log
 * group's existing retention policy. (`logRetention` is deprecated in favour
 * of `logGroup`, but that declares a LogGroup resource, which fails where
 * Lambda has already created the group.)
 */
function addEventMetrics(fn, namespace, eventNames, configuredAlarms = {}, { alarms: withAlarms = true } = {}) {
  const alarms = withAlarms ? { ...DEFAULT_EVENT_ALARMS, ...renameLegacyEvents(configuredAlarms) } : {};
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
      alarmDescription: `${name} logged ${threshold} or more times in 5 minutes${ALARM_NOTES[name] ? `. ${ALARM_NOTES[name]}` : ''}`,
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
  EVENT_LOG_RETENTION,
  GAUGES,
  eventMetricNamespace,
  alarmName,
  addEventMetrics,
  renameLegacyEvents,
};
