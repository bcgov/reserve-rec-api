// Authorizer for admin API access

const { authorizeAll, generatePolicy, getDenyPolicy, parseToken, validateToken } = require('./methods');
const { logger } = require('/opt/base');
const { getOne, USER_ID_PARTITION } = require('/opt/dynamodb');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

exports.handler = async function (event, context, callback) {
  logger.debug('Admin Authorizer', JSON.stringify(event));

  // Get config creds
  const config = {
    ADMIN_USER_POOL_CLIENT_ID: process.env.ADMIN_USER_POOL_CLIENT_ID || '',
    ADMIN_USER_POOL_ID: process.env.ADMIN_USER_POOL_ID || ''
  };
  if (!config.ADMIN_USER_POOL_ID || !config.ADMIN_USER_POOL_CLIENT_ID) {
    const dbConfig = await getOne('config', 'admin');
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
    const headers = event?.headers;
    const authorization = event?.headers?.Authorization;

    // Parse the input for methodArn
    logger.debug('event.methodArn', event?.methodArn);
    const tmp = event?.methodArn.split(':');
    const apiGatewayArnTmp = tmp[5].split('/');
    const region = tmp[3];
    const restApiId = apiGatewayArnTmp[0];
    const stage = apiGatewayArnTmp[1];
    const method = apiGatewayArnTmp[2];
    // determine the resource path
    let resource = '/'; // root resource
    let pathParams = tmp[5].split('/');
    for (let i = 3; i < pathParams.length; i++) {
      resource += pathParams[i];
      if (i + 1 < pathParams.length) {
        resource += '/';
      }
    }

    logger.info("Parse Token");
    const tokenData = await parseToken(headers, authorization);
    logger.debug("tokenData:", tokenData);
    if (tokenData?.valid && tokenData?.valid === true) {
      const payload = await validateToken(verifier, tokenData.token);
      logger.debug("payload:", payload);

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
        const arnPrefix = event.methodArn.split(':').slice(0, 6);
        const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
        const apiIDString = arnPrefix[5];
        const apiString = apiIDString.split('/')[0];
        const fullAPIMethods = joinedArnPrefix + ':' + apiString + '/' + process.env.STAGE_NAME + '/*';
        console.log("fullAPIMethods:", fullAPIMethods);
        return generatePolicy(sub, 'Allow', fullAPIMethods);
      } else {
        console.log("Deny");
        return generatePolicy(sub, 'Deny', event.methodArn);
      }
    } else {
      console.log("Invalid token");
      return await getDenyPolicy(event.methodArn);
    }
  } catch (e) {
    logger.error(JSON.stringify(e));
  }

  console.log("Deny");
  return getDenyPolicy(event.methodArn);
};