const { parsePhoneNumberFromString } = require('libphonenumber-js');

/**
 * Phone numbers: one definition of "deliverable", shared by the checks that
 * refuse a number and the sender that dials it.
 *
 * AWS End User Messaging takes E.164 only, so all valid numbers are normalized to E.164
 * before being stored or sent. libphonenumber-js provides the country specific 
 * parsing and validation. 
 * 
 * Keeping a second, stricter rule somewhere else is how an account ends up storing a number
 * the reminder then silently skips.
 *
 * Lives in the base layer because the Cognito triggers, the booking configs
 * and the SMS processor are packaged separately and none can require another.
 */

/**
 * @param {string} phoneNumber - as typed, separators and all
 * @returns {string|null} E.164-formatted number, or null if it cannot be resolved
 */
function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) {
    return null;
  }

  const trimmedPhoneNumber = String(phoneNumber).trim();

  const parsedPhoneNumber = parsePhoneNumberFromString(trimmedPhoneNumber, 'CA');

  if (!parsedPhoneNumber || !parsedPhoneNumber.isValid()) {
    return null;
  }

  return parsedPhoneNumber.number;
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
};
