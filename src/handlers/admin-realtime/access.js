'use strict';

const { adminListGroupsForUser } = require('/opt/cognito');
const { resolveAdminPermissions } = require('../authorizers/admin-permissions');

// A connection's access is its role plus its permission map. Keys are sorted so the
// same access always gives the same string, and a change shows as a different one.
function accessKey(role, permissions) {
  const sorted = Object.fromEntries(Object.entries(permissions ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ role: role ?? null, permissions: sorted });
}

/**
 * The user's current Cognito groups (not the token's, which can be hours old), or null
 * when there is no username or the user is no longer in the pool. Any other error throws.
 */
async function currentGroups(username) {
  if (!username) return null;
  try {
    return await adminListGroupsForUser(process.env.ADMIN_USER_POOL_ID, username);
  } catch (err) {
    if (err?.name === 'UserNotFoundException') return null;
    throw err;
  }
}

/**
 * Look the connection's user up again, the way the authorizer did at $connect, with
 * their current Cognito groups, so a group change shows too.
 * Returns { key, permissions }; both are null when the user no longer gets any access,
 * including when they were deleted from the pool. Any other lookup error throws.
 */
async function currentAccess(meta) {
  const groups = await currentGroups(meta.username);
  if (!groups) return { key: null, permissions: null };
  const resolved = await resolveAdminPermissions({ sub: meta.userId, 'cognito:groups': groups });
  if (resolved.unauthorized || !resolved.permissions) return { key: null, permissions: null };
  return { key: accessKey(resolved.role, resolved.permissions), permissions: resolved.permissions };
}

module.exports = { accessKey, currentGroups, currentAccess };
