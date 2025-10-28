// Authorizer for admin API access

const { authorizeAll, generatePolicy, getDenyPolicy, parseToken, validateToken } = require('./methods');
const { logger } = require('/opt/base');
const { getOne, USER_ID_PARTITION } = require('/opt/dynamodb');
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
    config = { ...dbConfig, ...config };
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
    logger.debug(`tokenData: ${tokenData}`);
    if (tokenData?.valid && tokenData?.valid === true) {
      const payload = await validateToken(verifier, tokenData.token);
      logger.debug(`payload: ${payload}`);

      // For now, so long as the token is valid, we will allow the user.
      // Later we will check group membership.

      return await authorizeAll(event);

      const sub = payload.sub;
      logger.debug("sub:", sub);

      // Grab the user's groups and inject into the context.
      const userData = await getOne(USER_ID_PARTITION, sub);
      logger.debug("userData:", userData);

      // Generate the methodArn for the user to access the API
      if (userData.claims?.includes('sysadmin')) {
        const arnPrefix = normalizedEvent.methodArn.split(':').slice(0, 6);
        const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
        const apiIDString = arnPrefix[5];
        const apiString = apiIDString.split('/')[0];
        const fullAPIMethods = joinedArnPrefix + ':' + apiString + '/' + process.env.STAGE_NAME + '/*';
        console.log("fullAPIMethods:", fullAPIMethods);
        return generatePolicy(sub, 'Allow', fullAPIMethods);
      } else {
        console.log("Deny");
        return generatePolicy(sub, 'Deny', normalizedEvent.methodArn);
      }
    } else {
      console.log("Invalid token");
      return await getDenyPolicy(normalizedEvent.methodArn);
    }
  } catch (e) {
    logger.error(JSON.stringify(e));
  }

  console.log("Deny");
  return getDenyPolicy(normalizedEvent.methodArn);
};