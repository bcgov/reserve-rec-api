const { logger } = require('/opt/base');
const { loadBlocklist, refusalReason, emailDomain } = require('/opt/emailBlocklist');
const { isValidPhoneNumber } = require('/opt/phone');

const BLOCKLIST_TABLE = process.env.BLOCKLIST_TABLE_NAME;

const PHONE_ATTRIBUTES = ['custom:mobilePhone', 'custom:secondaryNumber'];

const REFUSAL_MESSAGE = 'We could not complete your registration. Please contact support for assistance.';

// Flagged so the catch below tells a refusal from a fault without matching text.
class SignupRefused extends Error {
  constructor() {
    super(REFUSAL_MESSAGE);
    this.signupRefused = true;
  }
}

/**
 * Cognito PreSignUp trigger. Throwing rejects the signup.
 */
exports.handler = async (event) => {
  logger.debug('PreSignUp trigger', {
    userPoolId: event?.userPoolId,
    triggerSource: event?.triggerSource,
  });

  const email = event?.request?.userAttributes?.email;

  if (email) {
    try {
      const blocklist = await loadBlocklist(BLOCKLIST_TABLE);
      const reason = refusalReason(email, blocklist);

      if (reason) {
        // The domain is already on the list; the local part is not logged.
        logger.info('event=signup_refused', {
          reason,
          domain: emailDomain(email),
          clientId: event?.callerContext?.clientId,
          triggerSource: event?.triggerSource,
        });
        throw new SignupRefused();
      }
    } catch (err) {
      // A refusal must propagate; an infrastructure fault must not take
      // registration down with it.
      if (err.signupRefused) throw err;
      logger.error('PreSignUp blocklist check failed open', { error: err.message });
    }
  }

  // A number no SMS can reach is refused here rather than stored and skipped
  // at reminder time, where the only trace is a warn log nobody reads
  // (bcgov/reserve-rec-public#888). Empty is left alone: BCSC accounts arrive
  // without a number and add one in account settings, and the sign-up form
  // already requires its own.
  for (const attribute of PHONE_ATTRIBUTES) {
    const value = event?.request?.userAttributes?.[attribute];
    if (value && !isValidPhoneNumber(value)) {
      // The attribute is named, the number never is.
      logger.info('event=signup_phone_refused', { attribute });
      throw new Error('Enter a phone number with its area code, including a leading + for numbers outside Canada and the US.');
    }
  }

  return event;
};

exports.refusalReason = refusalReason;
