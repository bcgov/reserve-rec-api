// BCSC sends an ISO code; store the name the public site shows for it.
const BCSC_COUNTRY_NAMES = { CA: 'Canada' };

/**
 * The country to store on a user record: custom:country, else the BCSC address country.
 * @param {Object} userAttributes - Cognito user attributes
 * @param {Object} address - parsed BCSC address claim
 * @returns {string}
 */
function userCountry(userAttributes = {}, address = {}) {
  return userAttributes['custom:country'] || BCSC_COUNTRY_NAMES[address.country] || address.country || '';
}

module.exports = { userCountry };
