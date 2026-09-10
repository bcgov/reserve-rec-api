jest.mock('/opt/base', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
jest.mock('/opt/ssm', () => ({ getParameter: jest.fn() }));

const { canonicalizeEmail } = require('../lib/handlers/cognitoTriggers/preSignUp/canonicalizeEmail');
const { refusalReason } = require('../lib/handlers/cognitoTriggers/preSignUp');

// Synthetic, deliberately: the real list is defence data and does not belong in
// a repository. The shapes here mirror the three kinds the seed carries.
function makeBlocklist() {
  return {
    addresses: new Set(['banned@gmail.com', 'someone@example.com'].map(canonicalizeEmail)),
    domains: ['blocked.example', 'throwaway.test'],
    patterns: [/^sample[0-9]{4,}@gmail\.com$/i, /operatorsignature/i],
  };
}

describe('refusalReason', () => {
  const blocklist = makeBlocklist();

  it('refuses an exactly banned address', () => {
    expect(refusalReason('banned@gmail.com', blocklist)).toBe('address');
  });

  it('refuses the alias forms of a banned address', () => {
    // The evasions DUP had to hand-encode into every expression.
    for (const alias of [
      'banned+parkspass@gmail.com',
      'b.a.n.n.e.d@gmail.com',
      'B.a.N.n.E.d+xyz@GoogleMail.com',
    ]) {
      expect(refusalReason(alias, blocklist)).toBe('address');
    }
  });

  it('does not strip dots outside Google, so two mailboxes stay distinct', () => {
    // someone@example.com is banned; s.o.m.e.o.n.e@example.com is a different
    // mailbox at a dot-significant provider and must still be allowed.
    expect(refusalReason('s.o.m.e.o.n.e@example.com', blocklist)).toBeNull();
    expect(refusalReason('someone+tag@example.com', blocklist)).toBe('address');
  });

  it('refuses a blocked domain and its subdomains', () => {
    expect(refusalReason('anyone@blocked.example', blocklist)).toBe('domain');
    expect(refusalReason('anyone@mail.blocked.example', blocklist)).toBe('domain');
  });

  it('does not refuse a domain that merely ends with the same letters', () => {
    expect(refusalReason('anyone@notblocked.example', blocklist)).toBeNull();
  });

  it('refuses on a structural pattern', () => {
    expect(refusalReason('sample123456@gmail.com', blocklist)).toBe('pattern');
    expect(refusalReason('operatorsignature@anywhere.test', blocklist)).toBe('pattern');
  });

  it('allows an ordinary address', () => {
    expect(refusalReason('real.person@telus.net', blocklist)).toBeNull();
    expect(refusalReason('someone.else+holiday@gmail.com', blocklist)).toBeNull();
  });

  it('allows rather than throws on something that is not an address', () => {
    expect(refusalReason('not-an-email', blocklist)).toBeNull();
    expect(refusalReason('', blocklist)).toBeNull();
  });
});

describe('handler', () => {
  const { handler } = require('../lib/handlers/cognitoTriggers/preSignUp');
  const { getParameter } = require('/opt/ssm');

  const event = (email) => ({
    userPoolId: 'pool',
    triggerSource: 'PreSignUp_SignUp',
    request: { userAttributes: { email } },
  });

  beforeEach(() => {
    jest.resetModules();
    getParameter.mockReset();
  });

  it('fails open when the list cannot be read', async () => {
    // Registration must not go down estate-wide because SSM did. The WAF and
    // the verified-before-hold gate still stand behind this.
    getParameter.mockRejectedValue(new Error('SSM unavailable'));
    await expect(handler(event('anyone@example.com'))).resolves.toBeDefined();
  });

  it('passes an event with no email straight through', async () => {
    await expect(handler(event(undefined))).resolves.toBeDefined();
    expect(getParameter).not.toHaveBeenCalled();
  });
});
