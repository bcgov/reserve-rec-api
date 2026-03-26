// Authorizer for admin API access

const { authorizeAll, generatePolicy, getDenyPolicy, parseToken, validateToken, queryAndGenerateResources } = require('./methods');
const { logger } = require('/opt/base');
const { getOne, USER_ID_PARTITION, batchGetData } = require('/opt/dynamodb');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

/**
 * Normalize event format to handle both API Gateway v1.0 and v2.0 payload formats
 * and both TOKEN and REQUEST authorizer types
 */
function normalizeAuthorizerEvent(event) {
  // Detect the authorizer type and payload format

  if (event.type === 'TOKEN') {
    // TOKEN authorizer format
    return {
      headers: {}, // TOKEN authorizers don't have headers in the event
      authorizationToken: event.authorizationToken,
      methodArn: event.methodArn,
      requestContext: event.requestContext,
      authorizerType: 'TOKEN',
      payloadVersion: '1.0' // TOKEN authorizers are always v1.0
    };
  } else if (event.type === 'REQUEST' || event.headers || event.requestContext) {
    // REQUEST authorizer format
    const isV2 = event.version === '2.0' || event.routeArn || event.routeKey;

    if (isV2) {
      // API Gateway v2.0 format (HTTP API)
      return {
        headers: event.headers || {},
        methodArn: event.routeArn || event.methodArn,
        requestContext: event.requestContext,
        authorizerType: 'REQUEST',
        payloadVersion: '2.0'
      };
    } else {
      // API Gateway v1.0 format (REST API) - this is the default
      return {
        headers: event.headers || {},
        methodArn: event.methodArn,
        requestContext: event.requestContext,
        authorizerType: 'REQUEST',
        payloadVersion: '1.0'
      };
    }
  } else {
    // Fallback - assume REQUEST v1.0
    return {
      headers: event.headers || {},
      methodArn: event.methodArn,
      requestContext: event.requestContext,
      authorizerType: 'REQUEST',
      payloadVersion: '1.0'
    };
  }
}

/**
 * Get authorization header/token from normalized event
 */
function getAuthorizationToken(normalizedEvent) {
  if (normalizedEvent.authorizerType === 'TOKEN') {
    // For TOKEN authorizers, the token is directly in authorizationToken
    return normalizedEvent.authorizationToken;
  } else {
    // For REQUEST authorizers, extract from headers (case-insensitive)
    const headers = normalizedEvent.headers;
    return headers.Authorization ||
           headers.authorization ||
           headers.AUTHORIZATION ||
           null;
  }
}

exports.handler = async function (event, context, callback) {
  logger.debug(`Admin Authorizer: ${JSON.stringify(event)}`);

  // Normalize the event format
  const normalizedEvent = normalizeAuthorizerEvent(event);
  logger.debug(`Normalized event authorizer type: ${normalizedEvent.authorizerType}`);
  logger.debug(`Normalized event payload version: ${JSON.stringify(normalizedEvent.payloadVersion)}`);
  logger.debug(`Normalized headers: ${JSON.stringify(normalizedEvent.headers)}`);

  // Get config creds
  let config = {
    ADMIN_USER_POOL_CLIENT_ID: process.env.ADMIN_USER_POOL_CLIENT_ID || '',
    ADMIN_USER_POOL_ID: process.env.ADMIN_USER_POOL_ID || ''
  };
  if (!config.ADMIN_USER_POOL_ID || !config.ADMIN_USER_POOL_CLIENT_ID) {
    let dbConfig = await getOne('config', 'admin');
    if (!dbConfig) {
      throw new Error("No config found for admin authorizer.");
    }
    // DB values are the fallback; non-empty env vars take priority
    config = {
      ...dbConfig,
      ADMIN_USER_POOL_ID: dbConfig.ADMIN_USER_POOL_ID || process.env.ADMIN_USER_POOL_ID,
      ADMIN_USER_POOL_CLIENT_ID: dbConfig.ADMIN_USER_POOL_CLIENT_ID || process.env.ADMIN_USER_POOL_CLIENT_ID
    };
  }

  // default admin verifier
  let verifier = CognitoJwtVerifier.create({
    userPoolId: config.ADMIN_USER_POOL_ID,
    tokenUse: "access",
    clientId: config.ADMIN_USER_POOL_CLIENT_ID,
  });

  try {
    const headers = normalizedEvent.headers;
    const authorization = getAuthorizationToken(normalizedEvent);

    // Compute the ARN prefix once
    // e.g. arn:aws:execute-api:ca-central-1:123456789012:abc123
    //      arn:aws:execute-api:ca-central-1: <arnParts> :<apiId>
    const arnParts = normalizedEvent.methodArn.split(':');
    const arnPrefix = arnParts.slice(0, 5).join(':');
    const apiId = arnParts[5].split('/')[0];

    // Parse the input for methodArn
    logger.debug(`event.methodArn, ${normalizedEvent.methodArn}`);
    const tmp = normalizedEvent.methodArn.split(':');
    const apiGatewayArnTmp = tmp[5].split('/');
    const region = tmp[3];
    const restApiId = apiGatewayArnTmp[0];
    const stage = apiGatewayArnTmp[1];
    const method = apiGatewayArnTmp[2];
    // determine the resource path
    let resource = '/'; // root resource
    let pathParams = tmp[5].split('/');
    logger.debug(`pathParams: ${pathParams}`);
    for (let i = 3; i < pathParams.length; i++) {
      resource += pathParams[i];
      if (i + 1 < pathParams.length) {
        resource += '/';
      }
    }

    logger.info("Parse Token");
    const tokenData = await parseToken(headers, authorization);
    logger.debug(`tokenData: ${JSON.stringify(tokenData)}`);
    if (tokenData?.valid && tokenData?.valid === true) {
      const payload = await validateToken(verifier, tokenData.token);
      logger.debug(`payload: ${JSON.stringify(payload)}`);

      const sub = payload.sub;
      logger.debug(`sub: ${sub}`);

      // User hasn't been assigned a group in Cognito (yet)
      if (payload?.["cognito:groups"].some(group => group === 'unauthorized' || group.length === 0)) {
        console.log("Deny, user is in unauthorized group");
        return generatePolicy(sub, 'Deny', normalizedEvent.methodArn);
      } else if (payload?.["cognito:groups"].some(group => {
        // Any users that have been manually added to the SuperAdmin group in Cognito are granted everything
        return (group === 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup' ||
                group === 'ReserveRecApi-Test-AdminIdentityStack-SuperAdminGroup');
      })) {
        return {
          principalId: sub,
          policyDocument: {
            Version: '2012-10-17',
            Statement: [{
              Action: 'execute-api:Invoke',
              Effect: 'Allow',
              Resource: `${arnPrefix}:${apiId}/*`
            }]
          },
          context: {
            isAuthenticated: 'true',
            isAdmin: 'true',
            permissions: JSON.stringify({ superadmin: 'superadmin' }),
            cognitoSub: sub,
            username: payload.username || '',
          }
        };
      }

      // Grab the user's groups and the available staff.
      const userData = await getOne(`${USER_ID_PARTITION}::${sub}`, 'base');
      logger.debug(`userData: ${JSON.stringify(userData)}`);

      // If no permissions, user's sub still needs to be added to database
      if (!userData || !userData.permissions) {
        console.log("Deny, no permissions found for user - please add user sub to database with appropriate permissions");
        return generatePolicy(sub, 'Deny', normalizedEvent.methodArn);
      }

      // Get permissions as { bcparks_7: 'limited', bcparks_363: 'staff' } etc.
      const permissions = userData.permissions

      const allowedARNs = new Set();
      const stage = process.env.STAGE_NAME || '*';
      const basePath = `${arnPrefix}:${apiId}/${stage}`;

      // Get the unique tiers this user has, e.g., "staff", "limited"
      const userTiers = [...new Set(Object.values(permissions))];

      // Get the resource maps for each tier
      // e.g. "staff" => ["GET/facilities/*", "POST/facilities/*"]
      //      "limited" => ["GET/facilities/*"]
      const resourceMaps = await batchGetData(userTiers.map(tier => ({ pk: `resourceMap::${tier}`, sk: 'latest' })));

      for (const resource of resourceMaps) {
        for (const path of resource.allowedPaths) {
          // Add the path as a wildcarded ARN
          // e.g. "arn:.../GET/facilities/*"
          allowedARNs.add(`${basePath}/${path}`);
        }
      }

      // Always allow any authenticated user to retrieve their own permissions
      allowedARNs.add(`${basePath}/GET/users/me`);

      const policy = {
        principalId: sub,
        policyDocument: {
          Statement: [{
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: Array.from(allowedARNs)
          }]
        },
        context: {
          isAuthenticated: 'true',
          permissions: JSON.stringify(permissions),
          cognitoSub: sub,
          username: payload.username || '',
        }
      };

      return policy
    } else {
      console.log("Invalid token");
      return await getDenyPolicy(normalizedEvent.methodArn);
    }
  } catch (e) {
    logger.error("Error in admin authorizer:", e);
  }

  console.log("Deny");
  return getDenyPolicy(normalizedEvent.methodArn);
};
