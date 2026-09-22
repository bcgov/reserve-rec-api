const { logger } = require('/opt/base');
const { loadBlocklist, refusalReason } = require('/opt/emailBlocklist');
const { isValidPhoneNumber } = require('/opt/phone');

const BLOCKLIST_TABLE = process.env.BLOCKLIST_TABLE_NAME;

const PHONE_ATTRIBUTES = ['custom:mobilePhone', 'custom:secondaryNumber'];

/**
 * Cognito PreSignUp trigger.
 *
 * Throwing rejects the signup; Cognito surfaces the message to the caller. The
 * text is deliberately the same whichever rule fired — telling someone which
 * of their address, their domain, or a pattern matched tells them what to
 * change. It names support because a real person caught here needs a way back.
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
        // The reason is logged, never returned. Counted so the split between the
        // three rules is visible without reading the addresses themselves.
        logger.info('event=signup_refused', { reason });
        throw new Error('This email address cannot be used to create an account. Contact support if you believe this is an error.');
      }
    } catch (err) {
      // A refusal is a real answer and must propagate. Anything else — DynamoDB down,
      // a malformed list — must not: failing signup closed on an infrastructure
      // fault would take registration down estate-wide, and the WAF and the
      // verified-before-hold gate still stand behind this.
      if (err.message.startsWith('This email address cannot be used')) throw err;
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
