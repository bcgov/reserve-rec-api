const { getOne, USER_ID_PARTITION } = require('/opt/dynamodb');

const SUPERADMIN_GROUP_SUFFIX = '-AdminIdentityStack-SuperAdminGroup';
const SUPERADMIN_PERMISSIONS = { superadmin: 'superadmin' };
const SCOPED_ROLES = ['parkOperator', 'parkStaff'];
const FACILITY_KEY = /^[^:]+::[^:]+::[^:]+$/;
const USERS_ME_ONLY = { isSuperAdmin: false, permissions: null };

const isOrcs = (entry) => Number.isInteger(entry) && entry > 0;
const isFacilityKey = (entry) => typeof entry === 'string' && FACILITY_KEY.test(entry);

// The operator's cached facility keys still inside its grant (`parks` or
// `extraFacilities`), narrowed by `narrowTo` when the user has one. Sorted.
function scopedFacilities(operator, narrowTo) {
  const parks = Array.isArray(operator.parks) ? operator.parks : [];
  const extras = Array.isArray(operator.extraFacilities) ? operator.extraFacilities : [];
  return Object.entries(operator.facilities ?? {})
    .filter(([key, facility]) => parks.includes(facility?.orcs) || extras.includes(key))
    .filter(([key, facility]) => !narrowTo || narrowTo.includes(key) || narrowTo.includes(facility?.orcs))
    .map(([key]) => key)
    .sort();
}

const validNarrowTo = (narrowTo) =>
  narrowTo === undefined
  || (Array.isArray(narrowTo) && narrowTo.length > 0 && narrowTo.every((entry) => isOrcs(entry) || isFacilityKey(entry)));

async function resolveRole(user) {
  if (user.role === 'hqAdmin') {
    return { isSuperAdmin: false, role: 'hqAdmin', permissions: SUPERADMIN_PERMISSIONS };
  }
  if (!SCOPED_ROLES.includes(user.role) || !user.operatorId || !validNarrowTo(user.narrowTo)) {
    return USERS_ME_ONLY;
  }
  const operator = await getOne(`operator::${user.operatorId}`, 'base');
  if (!operator) return USERS_ME_ONLY;
  const facilities = scopedFacilities(operator, user.narrowTo);
  if (facilities.length === 0) return USERS_ME_ONLY;
  return { isSuperAdmin: false, role: user.role, permissions: {}, operatorId: user.operatorId, facilities };
}

/**
 * Resolve a verified admin-pool access token payload to its role and permission set.
 *
 * Returns one of:
 *   { unauthorized: true }                          the `unauthorized` group (or an empty group name), whatever the record says
 *   { isSuperAdmin: true, role: 'superadmin', permissions }   a SuperAdmin group member whose record has no `role`
 *   { isSuperAdmin: false, role: 'hqAdmin', permissions }     all access through { superadmin: 'superadmin' }
 *   { isSuperAdmin: false, role, permissions: {}, operatorId, facilities }   parkOperator / parkStaff
 *   { isSuperAdmin: false, permissions }            a record without `role`: its tier map minus any `superadmin` key
 *   { isSuperAdmin: false, permissions: null }      no usable record: callers allow GET /users/me only
 *
 * A record's `role` wins over the SuperAdmin group. The role comes only from the
 * record and those two groups, never from other token claims. A lookup error throws;
 * callers deny on error.
 */
async function resolveAdminPermissions(payload) {
  const groups = payload['cognito:groups'] ?? [];
  if (groups.some(group => group === 'unauthorized' || group.length === 0)) {
    return { unauthorized: true };
  }
  const user = await getOne(`${USER_ID_PARTITION}::${payload.sub}`, 'base');
  if (user && Object.hasOwn(user, 'role')) {
    return resolveRole(user);
  }
  if (groups.some(group => group.endsWith(SUPERADMIN_GROUP_SUFFIX))) {
    return { isSuperAdmin: true, role: 'superadmin', permissions: SUPERADMIN_PERMISSIONS };
  }
  if (!user?.permissions) return USERS_ME_ONLY;
  const { superadmin, ...permissions } = user.permissions;
  return { isSuperAdmin: false, permissions };
}

module.exports = { resolveAdminPermissions };
