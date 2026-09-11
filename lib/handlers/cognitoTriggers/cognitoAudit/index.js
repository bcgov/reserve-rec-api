const { logger } = require('/opt/base');

/**
 * EventBridge target for CloudTrail records of Cognito attribute calls.
 *
 * The pool triggers see a change only at the next login; this sees the change
 * as it happens, and also the admin and console paths that never fire a
 * trigger. It only logs. The address itself is never written: CloudTrail
 * redacts it on user calls and shows it in clear on admin calls, and this log
 * group must carry neither.
 */

const UPDATE_EVENTS = new Set(['UpdateUserAttributes', 'AdminUpdateUserAttributes']);
const DELETE_EVENTS = new Set(['DeleteUserAttributes', 'AdminDeleteUserAttributes']);
const VERIFY_EVENT = 'VerifyUserAttribute';

// CloudTrail's placeholder for a value it declined to record.
const REDACTED = 'HIDDEN_DUE_TO_SECURITY_REASONS';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Attribute names touched by the call, whichever shape the API uses. */
function attributeNames(eventName, params = {}) {
  if (UPDATE_EVENTS.has(eventName)) {
    return (Array.isArray(params.userAttributes) ? params.userAttributes : [])
      .map((a) => a?.name).filter(Boolean);
  }
  if (eventName === VERIFY_EVENT) return params.attributeName ? [params.attributeName] : [];
  if (DELETE_EVENTS.has(eventName)) {
    return Array.isArray(params.userAttributeNames) ? params.userAttributeNames : [];
  }
  return [];
}

/** Pool id, or null when the record does not carry one. */
function poolId(detail) {
  return detail?.requestParameters?.userPoolId
    || detail?.additionalEventData?.userPoolId
    || null;
}

/**
 * The subject. User calls carry it in additionalEventData; admin calls name
 * the user, which is the sub for native accounts but may be an alias — an
 * address — so only a UUID is accepted from there.
 */
function subjectOf(detail) {
  const fromEvent = detail?.additionalEventData?.sub;
  if (typeof fromEvent === 'string' && fromEvent) return fromEvent;
  const username = detail?.requestParameters?.username;
  return typeof username === 'string' && UUID.test(username) ? username : null;
}

function attributeValue(params, name) {
  const attr = (params?.userAttributes || []).find((a) => a?.name === name);
  return attr?.value;
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

  const names = attributeNames(eventName, params);
  const touchesEmail = names.includes('email');
  const sub = subjectOf(detail);

  if (eventName === 'UpdateUserAttributes' && touchesEmail) {
    const value = attributeValue(params, 'email');
    logger.info('event=email_change_requested', {
      sub,
      eventName,
      valueRedacted: value === undefined || value === REDACTED,
    });
    return;
  }

  if (eventName === VERIFY_EVENT && touchesEmail) {
    logger.info('event=email_change_verified', { sub });
    return;
  }

  if (eventName === 'AdminUpdateUserAttributes' && (touchesEmail || names.includes('email_verified'))) {
    // The assumed-role ARN ends in the session name, which for Lambda is the
    // function name; PreTokenGeneration's own email_verified repair for BCSC
    // accounts is identified that way and skipped.
    const principalArn = detail.userIdentity?.arn || null;
    const principalId = detail.userIdentity?.principalId || '';
    const fragment = process.env.SELF_ROLE_NAME_FRAGMENT;
    if (fragment && (String(principalArn).includes(fragment) || principalId.includes(fragment))) return;

    logger.info('event=email_change_admin', {
      sub,
      principalArn,
      emailVerifiedForced: attributeValue(params, 'email_verified') === 'true',
    });
    return;
  }

  if (DELETE_EVENTS.has(eventName) && touchesEmail) {
    logger.info('event=email_attributes_deleted', { sub, eventName });
  }
};
