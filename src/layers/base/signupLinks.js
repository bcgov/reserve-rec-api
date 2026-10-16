/**
 * Link entries in the SignupRefusal table: one item per normalised phone or
 * address, so a later account can be matched by key rather than by a scan.
 *
 *   pk  link#phone#<E.164> | link#address#<street>|<postal code>
 *   sk  <ISO time>#<ref>
 *   source  'refusal' (PreSignUp, expires with the refusal) | 'banned' (no expiry)
 *   ref     refusal record pk, or the banned account's sub
 *
 * Lives in the base layer because PreSignUp writes these and
 * PreTokenGeneration reads them, and neither can require the other.
 */
const { normalizePhoneNumber } = require('/opt/phone');

const LINK_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const LINK_SOURCES = ['banned', 'refusal'];

/**
 * @param {{streetAddress?: string, postalCode?: string}} parts
 * @returns {string|null} lowercased street and postal code, or null unless both are present
 */
function normalizeAddress({ streetAddress, postalCode } = {}) {
  const street = String(streetAddress ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const postal = String(postalCode ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  return street && postal ? `${street}|${postal}` : null;
}

/**
 * @param {{phones?: string[], streetAddress?: string, postalCode?: string}} fields
 * @returns {{matchedOn: 'phone'|'address', value: string, pk: string}[]} one per distinct number, then the address
 */
function linkKeys({ phones = [], streetAddress, postalCode } = {}) {
  const numbers = new Set(phones.map(normalizePhoneNumber).filter(Boolean));
  const keys = [...numbers].map((e164) => ({ matchedOn: 'phone', value: e164, pk: `link#phone#${e164}` }));
  const address = normalizeAddress({ streetAddress, postalCode });
  if (address) keys.push({ matchedOn: 'address', value: address, pk: `link#address#${address}` });
  return keys;
}

/**
 * First link that counts: a banned account at any age, or a refusal inside
 * the window. Banned beats refusal, then phone beats address.
 * @param {string} tableName
 * @param {ReturnType<typeof linkKeys>} keys
 * @param {number} [now] epoch ms
 * @returns {Promise<{source: string, matchedOn: string, ref: string}|null>}
 */
async function findLink(tableName, keys, now = Date.now()) {
  if (!keys.length) return null;
  // Required lazily so PreSignUp, which only writes links, does not load it.
  const { runQuery } = require('/opt/dynamodb');
  const cutoff = new Date(now - LINK_WINDOW_MS).toISOString();
  const results = await Promise.all(keys.map(({ pk }) => runQuery({
    TableName: tableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: pk } },
  }, null, null, false)));

  for (const source of LINK_SOURCES) {
    for (const [i, { items }] of results.entries()) {
      const hit = items.find((item) => item.source === source && (source === 'banned' || String(item.sk) >= cutoff));
      if (hit) return { source, matchedOn: keys[i].matchedOn, ref: hit.ref };
    }
  }
  return null;
}

module.exports = {
  findLink,
  linkKeys,
  normalizeAddress,
};
