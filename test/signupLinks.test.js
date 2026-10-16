const mockRunQuery = jest.fn();
jest.mock('/opt/dynamodb', () => ({ runQuery: (...args) => mockRunQuery(...args) }));

const { findLink, linkKeys, normalizeAddress } = require('/opt/signupLinks');

const NOW = Date.parse('2026-06-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// Items keyed by pk, standing in for the table.
function table(byPk) {
  mockRunQuery.mockImplementation(async (query) => ({
    items: byPk[query.ExpressionAttributeValues[':pk'].S] || [],
  }));
}

describe('normalizeAddress', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(normalizeAddress({ streetAddress: ' 1  Example St. ', postalCode: 'v0v 0v0' }))
      .toBe(normalizeAddress({ streetAddress: '1 example st', postalCode: 'V0V0V0' }));
  });

  it('needs both a street and a postal code', () => {
    expect(normalizeAddress({ streetAddress: '1 Example St' })).toBeNull();
    expect(normalizeAddress({ postalCode: 'V0V 0V0' })).toBeNull();
    expect(normalizeAddress()).toBeNull();
  });
});

describe('linkKeys', () => {
  it('keys a phone by its E.164 form', () => {
    expect(linkKeys({ phone: '(250) 555-0100' })).toEqual([
      { matchedOn: 'phone', value: '+12505550100', pk: 'link#phone#+12505550100' },
    ]);
  });

  it('skips a phone that does not resolve', () => {
    expect(linkKeys({ phone: '123' })).toEqual([]);
  });

  it('keys an address after the phone', () => {
    expect(linkKeys({ phone: '+12505550100', streetAddress: '1 Example St', postalCode: 'V0V 0V0' }).map((k) => k.pk))
      .toEqual(['link#phone#+12505550100', 'link#address#1 example st|v0v0v0']);
  });
});

describe('findLink', () => {
  const keys = linkKeys({ phone: '+12505550100', streetAddress: '1 Example St', postalCode: 'V0V 0V0' });
  const [phonePk, addressPk] = keys.map((k) => k.pk);

  beforeEach(() => mockRunQuery.mockReset());

  it('returns null without querying when there is nothing to match on', async () => {
    await expect(findLink('refusals', [], NOW)).resolves.toBeNull();
    expect(mockRunQuery).not.toHaveBeenCalled();
  });

  it('matches a refusal inside 90 days', async () => {
    table({ [phonePk]: [{ sk: `${iso(NOW - 89 * DAY)}#r-1`, source: 'refusal', ref: 'r-1' }] });
    await expect(findLink('refusals', keys, NOW)).resolves.toEqual({ source: 'refusal', matchedOn: 'phone', ref: 'r-1' });
  });

  // TTL deletion lags, so an expired item can still be read.
  it('ignores a refusal older than 90 days', async () => {
    table({ [phonePk]: [{ sk: `${iso(NOW - 91 * DAY)}#r-1`, source: 'refusal', ref: 'r-1' }] });
    await expect(findLink('refusals', keys, NOW)).resolves.toBeNull();
  });

  it('matches a banned account at any age', async () => {
    table({ [addressPk]: [{ sk: `${iso(NOW - 900 * DAY)}#sub-1`, source: 'banned', ref: 'sub-1' }] });
    await expect(findLink('refusals', keys, NOW)).resolves.toEqual({ source: 'banned', matchedOn: 'address', ref: 'sub-1' });
  });

  it('prefers a banned account over a refusal', async () => {
    table({
      [phonePk]: [{ sk: `${iso(NOW - DAY)}#r-1`, source: 'refusal', ref: 'r-1' }],
      [addressPk]: [{ sk: `${iso(NOW - DAY)}#sub-1`, source: 'banned', ref: 'sub-1' }],
    });
    await expect(findLink('refusals', keys, NOW)).resolves.toMatchObject({ source: 'banned', ref: 'sub-1' });
  });

  it('ignores an item with any other source', async () => {
    table({ [phonePk]: [{ sk: `${iso(NOW - DAY)}#x`, source: 'other', ref: 'x' }] });
    await expect(findLink('refusals', keys, NOW)).resolves.toBeNull();
  });

  it('queries each key in the named table', async () => {
    table({});
    await findLink('refusals', keys, NOW);
    expect(mockRunQuery.mock.calls.map(([q]) => [q.TableName, q.ExpressionAttributeValues[':pk'].S]))
      .toEqual([['refusals', phonePk], ['refusals', addressPk]]);
  });
});
