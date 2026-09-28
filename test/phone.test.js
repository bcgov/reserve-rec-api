const { normalizePhoneNumber, isValidPhoneNumber } = require('/opt/phone');

describe('normalizePhoneNumber', () => {
  it('reads a bare 10-digit number as NANP', () => {
    expect(normalizePhoneNumber('2505550123')).toBe('+12505550123');
    expect(normalizePhoneNumber('(250) 555-0123')).toBe('+12505550123');
  });

  it('keeps a stated country code rather than assuming NANP', () => {
    expect(normalizePhoneNumber('+447911123456')).toBe('+447911123456');
    expect(normalizePhoneNumber('+1 (250) 555-0123')).toBe('+12505550123');
  });

  it('accepts an 11-digit number that already carries the NANP country code', () => {
    expect(normalizePhoneNumber('12505550123')).toBe('+12505550123');
  });

  it('refuses a number too short for any country', () => {
    // The number that reached production: passed the old sign-up regex and was
    // stored, then skipped at reminder time.
    expect(normalizePhoneNumber('586588')).toBeNull();
    expect(normalizePhoneNumber('+44 20 7946')).toBeNull();
  });

  it('refuses more digits than E.164 allows', () => {
    expect(normalizePhoneNumber('+1234567890123456')).toBeNull();
  });

  it('refuses a value with no digits in it', () => {
    for (const value of ['', '   ', 'hh hg', null, undefined]) {
      expect(normalizePhoneNumber(value)).toBeNull();
    }
  });

  it('refuses an 11-digit number outside NANP written without a +', () => {
    // Nothing can tell this from a mistyped NANP number, so it is refused
    // rather than guessed at.
    expect(normalizePhoneNumber('44791112345')).toBeNull();
  });
});

describe('isValidPhoneNumber', () => {
  it('agrees with the normalizer', () => {
    expect(isValidPhoneNumber('2505550123')).toBe(true);
    expect(isValidPhoneNumber('586588')).toBe(false);
  });
});
