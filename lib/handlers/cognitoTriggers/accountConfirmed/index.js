const { logger } = require('/opt/base');

/**
 * Cognito PostConfirmation trigger. Counts confirmations and nothing else.
 *
 * Nothing in the Cognito metric namespace counts a confirmed signup, and the
 * PreTokenGeneration record is created at first login, so a person who
 * confirms and never returns was invisible. This line makes them a number.
 *
 * PostConfirmation also fires after a forgotten-password confirmation; that
 * is not a signup and is passed through unlogged. Federated (BCSC) users are
 * confirmed by their first sign-in and arrive here with a provider-prefixed
 * userName, recorded as `federated`.
 */
const SIGNUP_SOURCE = 'PostConfirmation_ConfirmSignUp';

exports.handler = async (event) => {
  try {
    if (event?.triggerSource === SIGNUP_SOURCE) {
      const sub = event.request?.userAttributes?.sub || null;
      const federated = typeof event.userName === 'string' && event.userName.includes('_');
      logger.info('event=account_confirmed', { sub, federated });
    }
  } catch (err) {
    // A trigger error here would fail the confirmation itself.
    logger.error('PostConfirmation trigger failed open', { error: err?.message });
  }
  return event;
};
