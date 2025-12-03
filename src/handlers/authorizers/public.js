// Authorizer for public API access

const { logger } = require('/opt/base');
const { authorizeAll, generatePolicy, getDenyPolicy, parseToken, validateToken, handleContextAndAPIKey } = require('./methods');
const { getOne } = require('/opt/dynamodb');
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
  logger.debug('Public Authorizer:', JSON.stringify(event));

  // Normalize the event format
  const normalizedEvent = normalizeAuthorizerEvent(event);
  logger.debug(`Normalized event authorizer type: ${normalizedEvent.authorizerType}`);
  logger.debug(`Normalized event payload version: ${JSON.stringify(normalizedEvent.payloadVersion)}`);
  logger.debug(`Normalized headers: ${JSON.stringify(normalizedEvent.headers)}`);

  // Get config creds
  let config = {
    PUBLIC_USER_POOL_CLIENT_ID: process.env.PUBLIC_USER_POOL_CLIENT_ID || '',
    PUBLIC_USER_POOL_ID: process.env.PUBLIC_USER_POOL_ID || ''
  };
  if (!config.PUBLIC_USER_POOL_ID || !config.PUBLIC_USER_POOL_CLIENT_ID) {
    let dbConfig = await getOne('config', 'public');
    if (!dbConfig) {
      throw new Error("No config found for public authorizer.");
    }
    config = { ...dbConfig, ...config };
  }

  // Create verifier only if we have valid config
  let verifier = null;
  if (config.PUBLIC_USER_POOL_ID && config.PUBLIC_USER_POOL_CLIENT_ID) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: config.PUBLIC_USER_POOL_ID,
      tokenUse: "access",
      clientId: config.PUBLIC_USER_POOL_CLIENT_ID,
    });
  }

  try {
    const headers = normalizedEvent.headers;
    const authorization = getAuthorizationToken(normalizedEvent);

    // Parse the methodArn to construct wildcard policy
    const arnPrefix = normalizedEvent.methodArn.split(':').slice(0, 6);
    const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
    const apiIDString = arnPrefix[5];
    const apiString = apiIDString.split('/')[0];
    const fullAPIMethods = joinedArnPrefix + ':' + apiString + '/*';

    // Attempt to parse and validate token if present
    let payload = null;
    let isAuthenticated = false;

    if (authorization && verifier) {
      logger.info("Attempting to parse and validate token");
      const tokenData = await parseToken(headers, authorization);
      
      if (tokenData?.valid && tokenData?.valid === true) {
        try {
          payload = await validateToken(verifier, tokenData.token);
          isAuthenticated = true;
          logger.info("Token is valid - authenticated user");
          logger.debug(`payload: ${JSON.stringify(payload)}`);
        } catch (error) {
          logger.info("Token validation failed - treating as guest");
          logger.debug(`Token validation error: ${error}`);
        }
      }
    } else {
      logger.info("No authorization token present - guest access");
    }

    // Generate policy with appropriate context
    let authResponse = generatePolicy('public', 'Allow', fullAPIMethods);
    authResponse = handleContextAndAPIKey(authResponse, payload, headers, isAuthenticated);
    
    logger.debug('Final authResponse', JSON.stringify(authResponse));
    return authResponse;

  } catch (e) {
    logger.error('Error in public authorizer:', JSON.stringify(e));
    // For public API, allow requests even on error but mark as guest
    let authResponse = generatePolicy('public', 'Allow', fullAPIMethods);
    authResponse = handleContextAndAPIKey(authResponse, null, normalizedEvent.headers, false);
    return authResponse;
  }
};
