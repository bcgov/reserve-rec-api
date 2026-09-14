const { logger } = require('/opt/base');

/**
 * Cognito CustomMessage trigger, used as a veto on self-service email changes.
 *
 * This relies on observed Cognito behaviour, not on a documented guarantee:
 * when the CustomMessage Lambda throws on CustomMessage_UpdateUserAttribute,
 * the pending attribute value is never stored, and the user is afterwards
 * indistinguishable from one who never attempted the change (a later
 * verify-user-attribute returns ExpiredCodeException, not CodeMismatch).
 * Verified 2026-09-11 against a throwaway pool. Re-verify after any change in
 * Cognito behaviour before relying on it.
 *
 * Other things established the same way:
 * - It fires only when AutoVerifiedAttributes includes email, because that is
 *   what makes an email change send a verification message.
 * - The event's userAttributes.email is the OLD address; the new one appears
 *   nowhere in the event. So this cannot check a denylist — it can only
 *   refuse the whole class of change.
 * - callerContext.clientId is a real app client id for self-service calls,
 *   and CLIENT_ID_NOT_APPLICABLE for admin-initiated ones.
 *
 * Every other trigger source (signup, forgot password, resend, verify) passes
 * through with the event returned exactly as received, so the pool keeps
 * using its configured message templates.
 */

const VETO_SOURCE = 'CustomMessage_UpdateUserAttribute';
const NO_CLIENT = 'CLIENT_ID_NOT_APPLICABLE';
const VETO_MESSAGE = 'Email address changes are not available. Contact support if you need to update your address.';

class EmailChangeVetoed extends Error {
  constructor() {
    super(VETO_MESSAGE);
    this.name = 'EmailChangeVetoed';
  }
}

exports.handler = async (event) => {
  try {
    if (event?.triggerSource !== VETO_SOURCE) return event;

    const sub = event.request?.userAttributes?.sub || event.userName || null;
    const clientId = event.callerContext?.clientId;
    const selfService = typeof clientId === 'string' && clientId !== '' && clientId !== NO_CLIENT;
    const source = selfService ? 'self-service' : 'admin';

    if (process.env.EMAIL_CHANGE_VETO !== 'true' || !selfService) {
      logger.info('event=email_change_observed', { sub, source });
      return event;
    }

    logger.warn('event=email_change_vetoed', { sub, clientId });
    throw new EmailChangeVetoed();
  } catch (err) {
    if (err instanceof EmailChangeVetoed) throw err;
    // A broken message trigger must not break signup or password reset.
    logger.error('CustomMessage trigger failed open', { error: err?.message });
    return event;
  }
};
