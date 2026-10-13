const { getOne, USER_ID_PARTITION } = require('/opt/dynamodb');

const SUPERADMIN_GROUP_SUFFIX = '-AdminIdentityStack-SuperAdminGroup';
const SUPERADMIN_PERMISSIONS = { superadmin: 'superadmin' };

/**
 * Resolve a verified admin-pool access token payload to its permission set.
 *
 * Returns one of:
 *   { unauthorized: true }                          the user is in the `unauthorized` group (or an empty group name)
 *   { isSuperAdmin: true, permissions }             a SuperAdmin group member: { superadmin: 'superadmin' }
 *   { isSuperAdmin: false, permissions }            the user record's { collectionId: tier } map, or null when there is none
 *
 * A payload with no `cognito:groups` claim throws; callers deny on error.
 */
async function resolveAdminPermissions(payload) {
  const groups = payload['cognito:groups'];
  if (groups.some(group => group === 'unauthorized' || group.length === 0)) {
    return { unauthorized: true };
  }
  if (groups.some(group => group.endsWith(SUPERADMIN_GROUP_SUFFIX))) {
    return { isSuperAdmin: true, permissions: SUPERADMIN_PERMISSIONS };
  }
  const userData = await getOne(`${USER_ID_PARTITION}::${payload.sub}`, 'base');
  return { isSuperAdmin: false, permissions: userData?.permissions || null };
}

module.exports = { resolveAdminPermissions };
