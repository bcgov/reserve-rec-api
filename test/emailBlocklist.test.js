jest.mock('/opt/ssm', () => ({ getParameter: jest.fn() }));
jest.mock('/opt/dynamodb', () => ({ runQuery: jest.fn() }));

const {
  BLOCKLIST_PK,
  canonicalizeEmail,
  emailDomain,
  domainMatches,
  itemsToLists,
  loadBlocklist,
  toItem,
} = require('/opt/emailBlocklist');

describe('canonicalizeEmail', () => {
  it('lowercases the whole address', () => {
    expect(canonicalizeEmail('Person@Example.COM')).toBe('person@example.com');
  });

  it('strips a subaddress tag at any provider', () => {
    expect(canonicalizeEmail('person+parks@example.com')).toBe('person@example.com');
    expect(canonicalizeEmail('person+a+b@example.com')).toBe('person@example.com');
  });

  it('strips dots only at Google', () => {
    expect(canonicalizeEmail('p.e.r.s.o.n@gmail.com')).toBe('person@gmail.com');
    // Elsewhere the local part is dot-significant: these are two mailboxes and
    // merging them would let one person's ban catch another.
    expect(canonicalizeEmail('p.e.r.s.o.n@example.com')).toBe('p.e.r.s.o.n@example.com');
  });

  it('treats googlemail as gmail', () => {
    expect(canonicalizeEmail('per.son+tag@googlemail.com')).toBe('person@gmail.com');
  });

  it('collapses onto one key the forms DUP had to hand-encode', () => {
    const forms = [
      'samplename123@gmail.com',
      's.a.m.p.l.e.n.a.m.e.1.2.3@gmail.com',
      'samplename123+parkspass@gmail.com',
      'SampleName123@GMail.com',
      's.a.m.p.l.e.n.a.m.e.1.2.3+x@googlemail.com',
    ];
    const canonical = forms.map(canonicalizeEmail);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe('samplename123@gmail.com');
  });

  it('rejects what is not an address', () => {
    for (const bad of ['', '  ', 'no-at-sign', 'a@b', '@example.com', 'a@', '+tag@example.com', null, undefined, 42]) {
      expect(canonicalizeEmail(bad)).toBeNull();
    }
  });

  it('keeps an address whose local part is only dots from becoming empty', () => {
    expect(canonicalizeEmail('...@gmail.com')).toBeNull();
  });

  it('splits on the last @, so the domain is never taken from the local part', () => {
    expect(canonicalizeEmail('weird@name@example.com')).toBe('weird@name@example.com');
  });
});

describe('emailDomain', () => {
  it('returns the canonical domain', () => {
    expect(emailDomain('Person+tag@GoogleMail.com')).toBe('gmail.com');
  });

  it('returns null for a non-address', () => {
    expect(emailDomain('nonsense')).toBeNull();
  });
});

describe('domainMatches', () => {
  it('matches the domain itself', () => {
    expect(domainMatches('example.com', 'example.com')).toBe(true);
  });

  it('matches subdomains, so a blanket covers them', () => {
    expect(domainMatches('mail.example.com', 'example.com')).toBe(true);
    expect(domainMatches('a.b.example.com', 'example.com')).toBe(true);
  });

  it('does not match a domain that merely ends with the same letters', () => {
    expect(domainMatches('notexample.com', 'example.com')).toBe(false);
    expect(domainMatches('example.com.evil.net', 'example.com')).toBe(false);
  });

  it('is false for empty input', () => {
    expect(domainMatches(null, 'example.com')).toBe(false);
    expect(domainMatches('example.com', null)).toBe(false);
  });
});

describe('toItem', () => {
  it('keys an address by its canonical form so the lookup finds it', () => {
    const item = toItem('address', 'S.a.m.p.l.e+tag@GoogleMail.com', { reason: 'r', addedBy: 'me', addedAt: 't' });
    expect(item).toEqual({
      pk: BLOCKLIST_PK, sk: 'address#sample@gmail.com', kind: 'address', value: 'sample@gmail.com',
      reason: 'r', addedBy: 'me', addedAt: 't',
    });
  });

  it('lowercases a domain', () => {
    expect(toItem('domain', ' Blocked.Example ').sk).toBe('domain#blocked.example');
  });

  it('refuses what could never match', () => {
    expect(() => toItem('address', 'not-an-address')).toThrow(/not an email/);
    expect(() => toItem('domain', 'nodot')).toThrow(/not a domain/);
    expect(() => toItem('pattern', '[unclosed')).toThrow();
    expect(() => toItem('ip', '1.2.3.4')).toThrow(/unknown blocklist kind/);
  });
});

describe('loadBlocklist', () => {
  // Synthetic entries; the real list is defence data and stays out of the repo.
  const items = [
    toItem('address', 'banned@gmail.com'),
    toItem('domain', 'blocked.example'),
    toItem('pattern', '^sample[0-9]{4,}@gmail\\.com$'),
  ];

  // The module caches per container, so each test gets its own instance. The
  // sources are required lazily, so the mocks are re-read after the reset too.
  function fresh() {
    jest.resetModules();
    const { loadBlocklist: load } = require('/opt/emailBlocklist');
    const { runQuery } = require('/opt/dynamodb');
    const { getParameter } = require('/opt/ssm');
    return { load, runQuery, getParameter };
  }

  it('reads the table', async () => {
    const { load, runQuery, getParameter } = fresh();
    runQuery.mockResolvedValue({ items });
    const list = await load({ tableName: 't' });
    expect(runQuery).toHaveBeenCalledWith(expect.objectContaining({ TableName: 't' }), null, null, false);
    expect(getParameter).not.toHaveBeenCalled();
    expect(list.addresses.has('banned@gmail.com')).toBe(true);
    expect(list.domains).toEqual(['blocked.example']);
    expect(list.patterns[0].test('sample12345@gmail.com')).toBe(true);
  });

  it('unions the table with the SSM parameter while both are configured', async () => {
    const { load, runQuery, getParameter } = fresh();
    runQuery.mockResolvedValue({ items });
    getParameter.mockResolvedValue(JSON.stringify({ addresses: ['B.a.n.n.e.d@gmail.com', 'other@example.com'], domains: ['blocked.example'] }));
    const list = await load({ tableName: 't', paramName: '/p' });
    expect(list.addresses).toEqual(new Set(['banned@gmail.com', 'other@example.com']));
    expect(list.domains).toEqual(['blocked.example']);   // deduplicated
  });

  it('still accepts the SSM parameter name alone', async () => {
    const { load, runQuery, getParameter } = fresh();
    getParameter.mockResolvedValue(JSON.stringify({ addresses: ['x@example.com'] }));
    const list = await load('/p');
    expect(runQuery).not.toHaveBeenCalled();
    expect(list.addresses.has('x@example.com')).toBe(true);
  });

  it('caches across calls', async () => {
    const { load, runQuery } = fresh();
    runQuery.mockResolvedValue({ items });
    await load({ tableName: 't' });
    await load({ tableName: 't' });
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it('propagates a table failure so the caller can fail open', async () => {
    const { load, runQuery } = fresh();
    runQuery.mockRejectedValue(new Error('down'));
    await expect(load({ tableName: 't' })).rejects.toThrow('down');
  });
});

describe('itemsToLists', () => {
  it('is the inverse of toItem, in the shape the parameter used', () => {
    expect(itemsToLists([toItem('address', 'a@example.com'), toItem('domain', 'd.example'), toItem('pattern', 'x')]))
      .toEqual({ addresses: ['a@example.com'], domains: ['d.example'], patterns: ['x'] });
  });
});
