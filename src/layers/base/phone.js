/**
 * Phone numbers: one definition of "deliverable", shared by the checks that
 * refuse a number and the sender that dials it.
 *
 * AWS End User Messaging takes E.164 only, so normalizing IS validating: a
 * number this cannot resolve is one no SMS will ever reach. Keeping a second,
 * stricter rule somewhere else is how an account ends up storing a number the
 * reminder then silently skips.
 *
 * Lives in the base layer because the Cognito triggers, the booking configs
 * and the SMS processor are packaged separately and none can require another.
 */

// E.164 caps the whole number at 15 digits. The floor is 10: a bare national
// number is read as NANP below, and nothing shorter is a subscriber's mobile.
const MIN_DIGITS = 10;
const MAX_DIGITS = 15;

/**
 * @param {string} phoneNumber - as typed, separators and all
 * @returns {string|null} E.164 (`+` and digits), or null if it cannot be resolved
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return null;
  }

  const trimmedPhoneNumber = String(phoneNumber).trim();
  const digits = trimmedPhoneNumber.replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  // A leading '+' is the caller stating its own country code — honour it
  // rather than assuming NANP.
  if (trimmedPhoneNumber.startsWith('+') && digits.length >= MIN_DIGITS && digits.length <= MAX_DIGITS) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  return null;
}

/**
 * @param {string} phoneNumber
 * @returns {boolean} true when the number resolves to E.164
 */
function isValidPhoneNumber(phoneNumber) {
  return normalizePhoneNumber(phoneNumber) !== null;
}

module.exports = {
  normalizePhoneNumber,
  isValidPhoneNumber,
  MIN_DIGITS,
  MAX_DIGITS,
};
