/**
 * Canonical form of an email address, for comparison against a ban list.
 *
 * This is the comparison, not a third control beside the address and domain
 * checks: `blocked+1@example.com` and `b.l.o.c.k.e.d@gmail.com` deliver to
 * inboxes already banned, so a list compared against raw input is evaded with
 * one keystroke and a single verified mailbox mints unlimited accounts.
 *
 * DUP solved this by hand-writing both rules into every one of its 188 WAF
 * expressions — `(\+[^"@]*)?@` on each address and an optional dot between
 * every character of each local part. That works and does not scale: each new
 * ban has to re-encode the same two rules correctly.
 *
 * Canonicalise on the way in AND when a ban is written, or the list fills with
 * entries that can never match.
 */

// Subaddressing: the part after '+' is routing, not identity. Applied to every
// provider, which is what DUP's expressions did in production. The alternative,
// refusing any address containing '+', refuses real people — plus-tagging is a
// documented feature many use deliberately for exactly this kind of signup.
const SUBADDRESS_SEPARATOR = '+';

// Dots are only insignificant at Google. Stripping them everywhere would merge
// genuinely different mailboxes at providers where the local part is
// dot-significant, and merging two strangers is how a ban hits the wrong one.
const DOT_INSENSITIVE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);

// googlemail.com is the same mailbox as gmail.com.
const DOMAIN_ALIASES = { 'googlemail.com': 'gmail.com' };

/**
 * @param {string} email
 * @returns {string|null} canonical address, or null if it is not parseable as one
 */
function canonicalizeEmail(email) {
  if (typeof email !== 'string') return null;

  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;

  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);

  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null;

  domain = DOMAIN_ALIASES[domain] || domain;

  const plus = local.indexOf(SUBADDRESS_SEPARATOR);
  if (plus === 0) return null;          // '+tag@host' has no mailbox to speak of
  if (plus > 0) local = local.slice(0, plus);

  if (DOT_INSENSITIVE_DOMAINS.has(domain)) local = local.split('.').join('');

  if (!local) return null;
  return `${local}@${domain}`;
}

/**
 * Registrable domain of an address, for suffix matching.
 * Returns the domain as written — subdomain coverage is the caller's job, since
 * a blocked `example.com` should also cover `mail.example.com`.
 */
function emailDomain(email) {
  const canonical = canonicalizeEmail(email);
  return canonical ? canonical.slice(canonical.lastIndexOf('@') + 1) : null;
}

/**
 * True when `domain` is the blocked domain or a subdomain of it.
 * Compares label-wise so `notexample.com` never matches `example.com`.
 */
function domainMatches(domain, blocked) {
  if (!domain || !blocked) return false;
  if (domain === blocked) return true;
  return domain.endsWith(`.${blocked}`);
}

module.exports = { canonicalizeEmail, emailDomain, domainMatches };
