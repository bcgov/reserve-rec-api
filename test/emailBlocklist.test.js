jest.mock('/opt/ssm', () => ({ getParameter: jest.fn() }));

const {
  canonicalizeEmail,
  emailDomain,
  domainMatches,
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
