'use strict';

const { resolveAdminPermissions } = require('../authorizers/admin-permissions');

// A connection's access is its role plus its permission map. Keys are sorted so the
// same access always gives the same string, and a change shows as a different one.
function accessKey(role, permissions) {
  const sorted = Object.fromEntries(Object.entries(permissions ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ role: role ?? null, permissions: sorted });
}

/**
 * Look the connection's user up again, the way the authorizer did at $connect.
 * Returns { key, permissions }; both are null when the user no longer gets any access.
 * A lookup error throws.
 */
async function currentAccess(meta) {
  const resolved = await resolveAdminPermissions({ sub: meta.userId, 'cognito:groups': meta.groups ?? [] });
  if (resolved.unauthorized || !resolved.permissions) return { key: null, permissions: null };
  return { key: accessKey(resolved.role, resolved.permissions), permissions: resolved.permissions };
}

module.exports = { accessKey, currentAccess };
