const { logger } = require('/opt/base');

/**
 * EventBridge target for CloudTrail records of Cognito attribute calls.
 *
 * The pool triggers see a change only at the next login; this sees the change
 * as it happens, and also the admin and console paths that never fire a
 * trigger. It only logs.
 *
 * CloudTrail redacts most of these records: on UpdateUserAttributes the whole
 * userAttributes field is one HIDDEN string, on the admin calls the username
 * too, and responseElements is null. What each event can say is therefore
 * decided by what the record carries, and where the attribute is unknowable
 * the line says so rather than guessing. The address is never written; the
 * only address-shaped thing logged is the masked delivery destination
 * CloudTrail itself emits (e.g. "t***@e***").
 */

const DELETE_EVENTS = new Set(['DeleteUserAttributes', 'AdminDeleteUserAttributes']);

// CloudTrail's placeholder for a value it declined to record.
const REDACTED = 'HIDDEN_DUE_TO_SECURITY_REASONS';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when CloudTrail withheld the value, or it is simply not there. */
function redacted(v) {
  return v === undefined || v === null || v === REDACTED;
}

/** Pool id, or null when the record does not carry one. */
function poolId(detail) {
  const fromRequest = detail?.requestParameters?.userPoolId;
  if (!redacted(fromRequest)) return fromRequest;
  const fromEvent = detail?.additionalEventData?.userPoolId;
  return redacted(fromEvent) ? null : fromEvent;
}

/**
 * The subject. User and admin calls both carry it in additionalEventData; the
 * admin username is a fallback only when it is a UUID, since an alias — an
 * address — is also accepted there.
 */
function subjectOf(detail) {
  const fromEvent = detail?.additionalEventData?.sub;
  if (typeof fromEvent === 'string' && fromEvent) return fromEvent;
  const username = detail?.requestParameters?.username;
  return typeof username === 'string' && UUID.test(username) ? username : null;
}

/** The code-delivery entry for the email attribute, or undefined. */
function emailDelivery(detail) {
  const list = detail?.responseElements?.codeDeliveryDetailsList;
  return (Array.isArray(list) ? list : []).find((d) => d?.attributeName === 'email');
}

exports.handler = async (event) => {
  const detail = event?.detail;
  if (!detail || detail.eventSource !== 'cognito-idp.amazonaws.com') return;

  const { eventName } = detail;
  const params = detail.requestParameters || {};

  // Only the public pool is of interest. A record without a pool id is kept:
  // dropping it would hide exactly the calls whose shape was not anticipated.
  const pool = poolId(detail);
  if (pool && pool !== process.env.PUBLIC_USER_POOL_ID) return;

  const sub = subjectOf(detail);

  if (eventName === 'UpdateUserAttributes') {
    // The request is one HIDDEN string; the only sign that email was touched
    // is the verification code Cognito reports sending for it.
    if (detail.errorCode) {
      logger.info('event=email_change_request_failed', { sub, errorCode: detail.errorCode });
      return;
    }
    const delivery = emailDelivery(detail);
    if (!delivery) return;
    logger.info('event=email_change_requested', {
      sub,
      eventName,
      deliveryMasked: typeof delivery.destination === 'string' ? delivery.destination : null,
    });
    return;
  }

  if (eventName === 'VerifyUserAttribute') {
    const name = params.attributeName;
    if (redacted(name)) {
      logger.info('event=attribute_verified', { sub, attributeKnown: false });
    } else if (name === 'email') {
      logger.info('event=email_change_verified', { sub });
    }
    return;
  }

  if (eventName === 'AdminUpdateUserAttributes') {
    // The assumed-role ARN ends in the session name, which for Lambda is the
    // function name; PreTokenGeneration's own email_verified repair for BCSC
    // accounts is identified that way and skipped.
    const principalArn = detail.userIdentity?.arn || null;
    const principalId = detail.userIdentity?.principalId || '';
    const fragment = process.env.SELF_ROLE_NAME_FRAGMENT;
    if (fragment && (String(principalArn).includes(fragment) || principalId.includes(fragment))) return;

    // Attributes are hidden on this call, so every one on the pool is noted.
    logger.info('event=admin_attributes_updated', { sub, principalArn, attributesKnown: false });
    return;
  }

  if (DELETE_EVENTS.has(eventName)) {
    const names = params.userAttributeNames;
    const known = Array.isArray(names);
    logger.info('event=attributes_deleted', {
      sub,
      eventName,
      attributesKnown: known,
      ...(known ? { emailIncluded: names.includes('email') } : {}),
    });
  }
};
