// Authorizer for public API access

const { logger } = require('/opt/base');
const { authorizeAll, generatePolicy, getDenyPolicy, parseToken, validateToken, handleContextAndAPIKey } = require('./methods');
const { getOne } = require('/opt/dynamodb');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

/**
 * Parses the bcparks-admission cookie value from a Cookie header string.
 * Returns the raw token string or null.
 */
function parseAdmissionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const idx = cookie.indexOf('=');
    if (idx === -1) continue;
    if (cookie.slice(0, idx).trim() === 'bcparks-admission') {
      return cookie.slice(idx + 1).trim();
    }
  }
  return null;
}

/**
 * Decodes the base64url payload from an admission token WITHOUT HMAC validation.
 * Used only to extract context fields for downstream Lambdas.
 * The booking handler performs full HMAC validation.
 */
function decodeAdmissionPayload(tokenStr) {
  if (!tokenStr) return null;
  const dot = tokenStr.indexOf('.');
  if (dot === -1) return null;
  try {
    return JSON.parse(Buffer.from(tokenStr.slice(0, dot), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

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

  // Parse admission cookie early so it's available in both try and catch paths.
  // NOTE: Only decodes the payload — does NOT validate HMAC signature.
  // Full HMAC validation is performed by the booking handler.
  const cookieStr = normalizedEvent.headers?.cookie || normalizedEvent.headers?.Cookie || '';
  const admissionToken = parseAdmissionCookie(cookieStr);
  const admissionPayload = admissionToken ? decodeAdmissionPayload(admissionToken) : null;
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
  // TODO: Consider using tokenUse 'id' instead of 'access' if the frontend can be updated to use ID tokens for auth (more standard for Cognito)
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

    // DEBUG: Log authorization status
    logger.info("==== AUTHORIZATION DEBUG ====");
    logger.info(`Authorization header present: ${!!authorization}`);
    logger.info(`Verifier created: ${!!verifier}`);
    if (authorization) {
      logger.info(`Authorization header value (first 30 chars): ${authorization.substring(0, 30)}...`);
    }
    if (verifier) {
      logger.info(`User Pool ID: ${config.PUBLIC_USER_POOL_ID}`);
      logger.info(`Client ID: ${config.PUBLIC_USER_POOL_CLIENT_ID}`);
    } else {
      logger.error(`❌ Verifier NOT created!`);
      logger.error(`USER_POOL_ID set: ${!!config.PUBLIC_USER_POOL_ID}`);
      logger.error(`CLIENT_ID set: ${!!config.PUBLIC_USER_POOL_CLIENT_ID}`);
    }
    logger.info("============================");

    // Parse the methodArn to construct wildcard policy
    const arnPrefix = normalizedEvent.methodArn.split(':').slice(0, 6);
    const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
    const apiIDString = arnPrefix[5];
    const apiString = apiIDString.split('/')[0];
    const fullAPIMethods = joinedArnPrefix + ':' + apiString + '/*';

    // Attempt to parse and validate token if present
    let payload = null;
    let isAuthenticated = false;

    if (!authorization) {
      logger.info("❌ No authorization header - defaulting to guest");
    } else if (!verifier) {
      logger.error("❌ Verifier not available - cannot validate token - defaulting to guest");
    } else {
      logger.info("✓ Authorization header present and verifier ready - attempting validation");

      try {
        const tokenData = await parseToken(headers, authorization);
        logger.info(`Token parse result: valid=${tokenData?.valid}, hasToken=${!!tokenData?.token}`);

        if (tokenData?.valid && tokenData?.valid === true) {
          try {
            logger.info("Attempting token validation with Cognito...");
            payload = await validateToken(verifier, tokenData.token);
            isAuthenticated = true;
            logger.info("✓✓ TOKEN VALIDATED SUCCESSFULLY - User authenticated");
            logger.info(`User sub: ${payload?.sub}`);
            logger.info(`Username: ${payload?.username || 'N/A'}`);
            logger.debug(`Full payload: ${JSON.stringify(payload)}`);
          } catch (error) {
            logger.error("❌ Token validation failed - treating as guest");
            logger.error(`Validation error: ${error.message}`);
            logger.error(`Error name: ${error.name}`);
            logger.debug(`Error stack: ${error.stack}`);
          }
        } else {
          logger.warn("❌ Token parse returned invalid - check token format");
          logger.warn(`Expected format: 'Authorization: Bearer <token>'`);
          logger.debug(`Parsed token data: ${JSON.stringify(tokenData)}`);
        }
      } catch (parseError) {
        logger.error("❌ Error during token parsing:");
        logger.error(`Parse error: ${parseError.message}`);
        logger.debug(`Parse error stack: ${parseError.stack}`);
      }
    }

    // Generate policy with appropriate context
    let authResponse = generatePolicy('public', 'Allow', fullAPIMethods);
    authResponse = handleContextAndAPIKey(authResponse, payload, headers, isAuthenticated);

    // Attach admission cookie context (unverified — HMAC validation in booking handler)
    authResponse.context = {
      ...authResponse.context,
      admissionPresent: admissionToken ? 'true' : 'false',
      admissionFacilityKey: admissionPayload?.fk || '',
      admissionDateKey: admissionPayload?.dk || '',
    };

    logger.debug('Final authResponse', JSON.stringify(authResponse));
    return authResponse;

  } catch (e) {
    logger.error('Error in public authorizer:', JSON.stringify(e));
    // For public API, allow requests even on error but mark as guest
    let authResponse = generatePolicy('public', 'Allow', fullAPIMethods);
    authResponse = handleContextAndAPIKey(authResponse, null, normalizedEvent.headers, false);
    authResponse.context = {
      ...authResponse.context,
      admissionPresent: admissionToken ? 'true' : 'false',
      admissionFacilityKey: admissionPayload?.fk || '',
      admissionDateKey: admissionPayload?.dk || '',
    };
    return authResponse;
  }
};
