const { logger } = require('/opt/base');
const { loadBlocklist, refusalReason } = require('/opt/emailBlocklist');

const BLOCKLIST_PARAM = process.env.BLOCKLIST_SSM_PARAM;

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
  if (!email) return event;

  try {
    const blocklist = await loadBlocklist(BLOCKLIST_PARAM);
    const reason = refusalReason(email, blocklist);

    if (reason) {
      // The reason is logged, never returned. Counted so the split between the
      // three rules is visible without reading the addresses themselves.
      logger.info('event=signup_refused', { reason });
      throw new Error('This email address cannot be used to create an account. Contact support if you believe this is an error.');
    }
  } catch (err) {
    // A refusal is a real answer and must propagate. Anything else — SSM down,
    // a malformed list — must not: failing signup closed on an infrastructure
    // fault would take registration down estate-wide, and the WAF and the
    // verified-before-hold gate still stand behind this.
    if (err.message.startsWith('This email address cannot be used')) throw err;
    logger.error('PreSignUp blocklist check failed open', { error: err.message });
  }

  return event;
};

exports.refusalReason = refusalReason;
