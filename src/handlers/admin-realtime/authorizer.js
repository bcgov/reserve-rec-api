'use strict';

const { logger } = require('/opt/base');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { resolveAdminPermissions } = require('../authorizers/admin-permissions');
const { TOPICS, canSubscribe } = require('./topics');
const { accessKey, currentGroups } = require('./access');

let verifier;
function getVerifier() {
  verifier ??= CognitoJwtVerifier.create({
    userPoolId: process.env.ADMIN_USER_POOL_ID,
    clientId: process.env.ADMIN_USER_POOL_CLIENT_ID,
    tokenUse: 'access',
  });
  return verifier;
}

function policy(principalId, effect, resource, context) {
  return {
    principalId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [{ Action: 'execute-api:Invoke', Effect: effect, Resource: resource }],
    },
    ...(context && { context }),
  };
}

/**
 * Lambda REQUEST authorizer for the admin realtime $connect route.
 * Accepts only admin-pool access tokens passed as ?token=<jwt>.
 */
exports.handler = async (event) => {
  const methodArn = event.methodArn;
  const token = event.queryStringParameters?.token;
  if (!token) {
    logger.info('Admin realtime auth: no token in query string');
    return policy('anonymous', 'Deny', methodArn);
  }

  let payload;
  try {
    payload = await getVerifier().verify(token);
  } catch (err) {
    logger.info('Admin realtime auth: token rejected', { reason: err.name, error: err.message });
    return policy('anonymous', 'Deny', methodArn);
  }

  const sub = payload.sub;
  try {
    // Current groups, as subscribe and the recheck use, so all three agree on the user's access
    const groups = await currentGroups(payload.username);
    if (!groups) {
      logger.info('Admin realtime auth: deny, user not in the pool', { userId: sub });
      return policy(sub, 'Deny', methodArn);
    }
    const { unauthorized, isSuperAdmin, role, permissions } = await resolveAdminPermissions({ ...payload, 'cognito:groups': groups });
    if (unauthorized) {
      logger.info('Admin realtime auth: deny, unauthorized group', { userId: sub });
      return policy(sub, 'Deny', methodArn);
    }
    if (!permissions) {
      logger.info('Admin realtime auth: deny, no permissions record', { userId: sub });
      return policy(sub, 'Deny', methodArn);
    }
    if (!Object.keys(TOPICS).some(topic => canSubscribe(topic, permissions))) {
      logger.info('Admin realtime auth: deny, no topic allowed', { userId: sub });
      return policy(sub, 'Deny', methodArn);
    }
    return policy(sub, 'Allow', methodArn, {
      userId: sub,
      permissions: JSON.stringify(permissions),
      isSuperAdmin: String(isSuperAdmin),
      exp: String(payload.exp),
      // Saved so subscribe and the recheck can look the user and their groups up again
      username: payload.username,
      accessKey: accessKey(role, permissions),
    });
  } catch (err) {
    logger.error('Admin realtime auth: permission lookup failed', { userId: sub, reason: err.name, error: err.message });
    return policy(sub, 'Deny', methodArn);
  }
};
