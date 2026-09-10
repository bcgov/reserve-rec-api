const { logger } = require('/opt/base');
const { getParameter } = require('/opt/ssm');
const { canonicalizeEmail, emailDomain, domainMatches } = require('./canonicalizeEmail');

const BLOCKLIST_PARAM = process.env.BLOCKLIST_SSM_PARAM;

// The list is small and changes rarely, so one fetch serves the container's
// life. A signup is on a person's critical path; an SSM round trip per attempt
// is not worth paying for a list that moves weekly.
let cached = null;

async function loadBlocklist() {
  if (cached) return cached;
  const raw = JSON.parse(await getParameter(BLOCKLIST_PARAM, false));
  cached = {
    // Canonicalised again here rather than trusted: an entry written in raw
    // form would sit in the list forever without ever matching anything.
    addresses: new Set((raw.addresses || []).map(canonicalizeEmail).filter(Boolean)),
    domains: (raw.domains || []).map((d) => String(d).trim().toLowerCase()).filter(Boolean),
    patterns: (raw.patterns || []).map((p) => new RegExp(p, 'i')),
  };
  return cached;
}

/**
 * Why an address is refused, or null to allow.
 * Order is cheapest-first, and exact match before the broader rules.
 */
function refusalReason(email, blocklist) {
  const canonical = canonicalizeEmail(email);
  if (!canonical) return null;   // unparseable is Cognito's problem, not ours

  if (blocklist.addresses.has(canonical)) return 'address';

  const domain = emailDomain(email);
  if (blocklist.domains.some((d) => domainMatches(domain, d))) return 'domain';

  // Structural rules that are not addresses: a local-part shape, or a
  // signature string that identifies an operator across many addresses.
  if (blocklist.patterns.some((re) => re.test(canonical))) return 'pattern';

  return null;
}

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
    const blocklist = await loadBlocklist();
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
