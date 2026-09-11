/**
 * Email blocklist: canonical-form comparison plus the SSM-backed list.
 *
 * Lives in the base layer because both Cognito triggers need it and each
 * handler directory is packaged on its own, so one cannot require the other.
 *
 * Canonical form is the comparison, not a third control beside the address and
 * domain checks: `blocked+1@example.com` and `b.l.o.c.k.e.d@gmail.com` deliver
 * to inboxes already banned, so a list compared against raw input is evaded
 * with one keystroke and a single verified mailbox mints unlimited accounts.
 *
 * DUP solved this by hand-writing both rules into every one of its 188 WAF
 * expressions — `(\+[^"@]*)?@` on each address and an optional dot between
 * every character of each local part. That works and does not scale: each new
 * ban has to re-encode the same two rules correctly.
 *
 * Canonicalise on the way in AND when a ban is written, or the list fills with
 * entries that can never match.
 *
 * The list lives in DynamoDB, one item per entry, so each ban carries its own
 * reason and date and adding one is a single put rather than a read-modify-
 * write of a JSON blob. SSM was the first home and hit its 8KB ceiling; it is
 * still read while an environment is being seeded, then dropped.
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

// One partition holds the whole list; the sort key is `<kind>#<value>`.
const BLOCKLIST_PK = 'signup';
const KINDS = ['address', 'domain', 'pattern'];

/**
 * Build the DynamoDB item for one entry. Addresses are canonicalised here so
 * the key is the form the lookup produces; an entry stored raw never matches.
 * @param {'address'|'domain'|'pattern'} kind
 * @param {string} value
 * @param {{reason?: string, addedBy?: string, addedAt?: string}} [meta]
 */
function toItem(kind, value, meta = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown blocklist kind: ${kind}`);
  let key;
  if (kind === 'address') {
    key = canonicalizeEmail(value);
    if (!key) throw new Error(`not an email address: ${value}`);
  } else if (kind === 'domain') {
    key = String(value).trim().toLowerCase();
    if (!key || !key.includes('.')) throw new Error(`not a domain: ${value}`);
  } else {
    key = String(value);
    new RegExp(key, 'i');   // throws on an invalid expression before it is stored
  }
  return {
    pk: BLOCKLIST_PK,
    sk: `${kind}#${key}`,
    kind,
    value: key,
    reason: meta.reason || '',
    addedBy: meta.addedBy || '',
    addedAt: meta.addedAt || new Date().toISOString(),
  };
}

/** Empty list, the shape every consumer expects. */
function emptyBlocklist() {
  return { addresses: new Set(), domains: [], patterns: [] };
}

/**
 * Fold a source into a blocklist. Entries are canonicalised again rather than
 * trusted: one written in raw form would sit in the list forever without ever
 * matching anything.
 */
function addEntries(list, { addresses = [], domains = [], patterns = [] }) {
  for (const a of addresses) {
    const c = canonicalizeEmail(a);
    if (c) list.addresses.add(c);
  }
  for (const d of domains) {
    const c = String(d).trim().toLowerCase();
    if (c && !list.domains.includes(c)) list.domains.push(c);
  }
  for (const p of patterns) list.patterns.push(new RegExp(p, 'i'));
  return list;
}

/** DynamoDB items → the JSON shape the SSM parameter used. */
function itemsToLists(items) {
  const lists = { addresses: [], domains: [], patterns: [] };
  for (const item of items) {
    if (item.kind === 'address') lists.addresses.push(item.value);
    else if (item.kind === 'domain') lists.domains.push(item.value);
    else if (item.kind === 'pattern') lists.patterns.push(item.value);
  }
  return lists;
}

// A signup or login is on a person's critical path; a fetch per attempt is not
// worth paying for a list that moves daily at most. Five minutes bounds how
// long a new ban takes to bite on a warm container.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached = null;
let cachedAt = 0;

/**
 * @param {{tableName?: string, paramName?: string}} sources - the table, and
 *   the SSM parameter while one still exists; either may be unset
 * @returns {Promise<{addresses: Set<string>, domains: string[], patterns: RegExp[]}>}
 */
async function loadBlocklist(sources) {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  // Legacy call shape: loadBlocklist('/ssm/param/name').
  const { tableName, paramName } = typeof sources === 'string' ? { paramName: sources } : (sources || {});
  const list = emptyBlocklist();

  if (tableName) {
    const { runQuery } = require('/opt/dynamodb');
    const { items } = await runQuery({
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': { S: BLOCKLIST_PK } },
    }, null, null, false);
    addEntries(list, itemsToLists(items));
  }
  if (paramName) {
    const { getParameter } = require('/opt/ssm');
    addEntries(list, JSON.parse(await getParameter(paramName, false)));
  }

  cached = list;
  cachedAt = Date.now();
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

module.exports = {
  BLOCKLIST_PK,
  KINDS,
  canonicalizeEmail,
  domainMatches,
  emailDomain,
  itemsToLists,
  loadBlocklist,
  refusalReason,
  toItem,
};
