const { adminGetUser } = require('/opt/cognito');

// `identities` is a JSON string in AdminGetUser attributes and an array in ID tokens.
function isBcsc(identities) {
  let parsed = identities;
  if (typeof identities === 'string') {
    try {
      parsed = JSON.parse(identities);
    } catch {
      return false;
    }
  }
  return Array.isArray(parsed) && parsed.some((id) => id?.providerName === 'BCSC');
}

/**
 * Classifies an account for the token's sub: 'active', 'unverified', 'disabled' or 'missing'.
 * Takes an AdminGetUser result or a verified Cognito ID token payload.
 */
function accountStatus(account, sub) {
  const attrs = account?.UserAttributes;
  const get = attrs
    ? (name) => attrs.find((a) => a.Name === name)?.Value
    : (name) => account?.[name];
  if (get('sub') !== sub) return 'missing';
  if (account.Enabled === false) return 'disabled';
  const emailVerified = get('email_verified') === true || get('email_verified') === 'true';
  // Cognito resets email_verified on every BCSC login, so BCSC accounts count as verified.
  return emailVerified || isBcsc(get('identities')) ? 'active' : 'unverified';
}

/**
 * Looks the account up and classifies it. A missing user is status 'missing';
 * any other Cognito error (throttling included) is thrown for the caller's policy.
 */
async function getAccountStatus(userPoolId, sub, username) {
  try {
    const user = await adminGetUser(userPoolId, username || sub);
    return { status: accountStatus(user, sub), user };
  } catch (error) {
    if (error?.cause?.name === 'UserNotFoundException') return { status: 'missing', user: null };
    throw error;
  }
}

module.exports = { accountStatus, getAccountStatus };
