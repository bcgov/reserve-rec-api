/**
 * Builds the Cognito custom verification email body from the branded template
 * added in #460.
 *
 * The template was committed but never wired up: the pool sent Cognito's
 * default "your code is ..." email, which is what QA kept seeing
 * (bcgov/reserve-rec-public#502). Cognito sends this email as an HTML string
 * with no attachment support, so its images are fetched over HTTP from the
 * public app (reserve-rec-public/src/assets/email → /dayuse/assets/email) and
 * the template's placeholder host is substituted here.
 */
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, 'verify-account-email.html');

// RFC 2606 reserved TLD, so an unsubstituted template can never silently
// resolve to something real.
const PLACEHOLDER_BASE = 'https://ASSET_BASE.invalid/email/';

// Cognito requires the code placeholder in a custom verification body, and
// caps EmailMessage at 20,000 characters.
const CODE_PLACEHOLDER = '{####}';
const MAX_EMAIL_BODY = 20000;

/**
 * @param {string} assetBaseUrl - public base URL the images are served from,
 *   with or without a trailing slash. Falsy returns null, which leaves the pool
 *   on Cognito's default email rather than sending one with broken images.
 * @param {string} [html] - template contents; read from disk when omitted.
 * @returns {string|null} the email body, or null when no base URL is configured.
 */
function buildVerificationEmail(assetBaseUrl, html) {
  if (!assetBaseUrl) {
    return null;
  }

  const base = assetBaseUrl.endsWith('/') ? assetBaseUrl : `${assetBaseUrl}/`;
  const body = (html ?? fs.readFileSync(TEMPLATE_PATH, 'utf8')).split(PLACEHOLDER_BASE).join(base);

  if (body.includes('ASSET_BASE.invalid')) {
    throw new Error('Verification email still references ASSET_BASE.invalid after substitution');
  }
  if (!body.includes(CODE_PLACEHOLDER)) {
    throw new Error(`Verification email template is missing the ${CODE_PLACEHOLDER} code placeholder`);
  }
  if (body.length > MAX_EMAIL_BODY) {
    throw new Error(`Verification email body is ${body.length} characters; Cognito allows ${MAX_EMAIL_BODY}`);
  }

  return body;
}

module.exports = {
  buildVerificationEmail,
  TEMPLATE_PATH,
  PLACEHOLDER_BASE,
  CODE_PLACEHOLDER,
  MAX_EMAIL_BODY,
};
