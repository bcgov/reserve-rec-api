/**
 * Cognito verification email body (bcgov/reserve-rec-public#502).
 */
const fs = require('fs');
const {
  buildVerificationEmail,
  TEMPLATE_PATH,
  PLACEHOLDER_BASE,
  CODE_PLACEHOLDER,
} = require('../lib/public-identity-stack/verification-email');

const BASE = 'https://test-reserve.bcparks.ca/dayuse/assets/email';

describe('buildVerificationEmail', () => {
  it('returns null when no asset base is configured', () => {
    // The pool then stays on Cognito's default email rather than sending a
    // branded one whose images all 404.
    expect(buildVerificationEmail(undefined)).toBeNull();
    expect(buildVerificationEmail('')).toBeNull();
  });

  it('substitutes the placeholder host', () => {
    const body = buildVerificationEmail(BASE, `<img src="${PLACEHOLDER_BASE}icon-email.png">${CODE_PLACEHOLDER}`);

    expect(body).toContain(`${BASE}/icon-email.png`);
    expect(body).not.toContain('ASSET_BASE.invalid');
  });

  it('does not double the slash when the base already ends in one', () => {
    const body = buildVerificationEmail(`${BASE}/`, `${PLACEHOLDER_BASE}icon-email.png ${CODE_PLACEHOLDER}`);

    expect(body).toContain(`${BASE}/icon-email.png`);
    expect(body).not.toContain('email//icon-email.png');
  });

  it('rejects a template with no code placeholder', () => {
    expect(() => buildVerificationEmail(BASE, '<p>no code here</p>'))
      .toThrow(/missing the \{####\} code placeholder/);
  });

  it('rejects a body over the Cognito limit', () => {
    const huge = `${CODE_PLACEHOLDER}${'x'.repeat(20000)}`;

    expect(() => buildVerificationEmail(BASE, huge)).toThrow(/Cognito allows 20000/);
  });
});

describe('the real template', () => {
  const body = buildVerificationEmail(BASE);

  it('points every image at the configured base', () => {
    const remaining = body.match(/ASSET_BASE/g) || [];

    expect(remaining).toHaveLength(0);
    for (const file of [
      'bcparks-logo.png',
      'bcparks-wordmark-white.png',
      'icon-email.png',
      'icon-facebook.png',
      'icon-instagram.png',
    ]) {
      expect(body).toContain(`${BASE}/${file}`);
    }
  });

  it('keeps the code placeholder Cognito requires', () => {
    expect(body).toContain(CODE_PLACEHOLDER);
  });

  it('fits inside the Cognito body limit', () => {
    expect(body.length).toBeLessThan(20000);
  });

  it('references no images the public app does not ship', () => {
    const referenced = [...fs.readFileSync(TEMPLATE_PATH, 'utf8').matchAll(/ASSET_BASE\.invalid\/email\/([\w.-]+)/g)]
      .map(m => m[1]);

    expect(new Set(referenced)).toEqual(new Set([
      'bcparks-logo.png',
      'bcparks-wordmark-white.png',
      'icon-email.png',
      'icon-facebook.png',
      'icon-instagram.png',
    ]));
  });
});
