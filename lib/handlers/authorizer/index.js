const { logger } = require('/opt/base');
const { TABLE_NAME, getOne, USER_ID_PARTITION } = require('/opt/dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

exports.handler = async function (event, context, callback) {
  logger.debug('event', JSON.stringify(event));

  // TODO: Implement the authorizer logic

  // // Get config creds
  // const config = await getOne('config', 'public');

  // // default public verifier
  // let verifier = CognitoJwtVerifier.create({
  //   userPoolId: config.PUBLIC_USER_POOL_ID,
  //   tokenUse: "access",
  //   clientId: config.PUBLIC_USER_POOL_CLIENT_ID
  // });


  return await authorizeAll(event, verifier);

  try {
    const headers = event?.headers;
    const authorization = event?.headers?.Authorization;

    console.log("Parse Token");
    const tokenData = await parseToken(headers, authorization);
    console.log(tokenData);
    if (tokenData.valid === false) {
      console.log("Invalid token");
      return await getDenyPolicy(event.methodArn);
    }
    const payload = await validateToken(tokenData.token);
    const sub = payload.sub;
    console.log("sub:", sub);

    // Grab the user's groups and inject into the context.
    const userData = await getOne(USER_ID_PARTITION, sub);
    console.log("userData:", userData);

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
  } catch (e) {
    logger.error(JSON.stringify(e));
  }

  console.log("Deny");
  return getDenyPolicy(event.methodArn);
};

async function authorizeAll(event, verifier) {
  const arnPrefix = event.methodArn.split(':').slice(0, 6);
  const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
  const apiIDString = arnPrefix[5];
  const apiString = apiIDString.split('/')[0];
  const fullAPIMethods = joinedArnPrefix + ':' + apiString + '/' + process.env.STAGE_NAME + '/*';
  console.log("fullAPIMethods:", fullAPIMethods);
  return generatePolicy('pub', 'Allow', fullAPIMethods, verifier);
}

async function getUserData(sub) {
  const dynamodb = new DynamoDBClient();
  const params = {
    TableName: TABLE_NAME,
    Key: {
      pk: { S: 'userid' },
      sk: { S: sub }
    }
  };

  try {
    const data = await dynamodb.getItem(params).promise();
    if (!data.Item) {
      throw new Error('User not found');
    }
    return data.Item;
  } catch (error) {
    logger.error('Error fetching user data:', error);
    throw error;
  }
}

async function validateToken(token, verifier) {
  try {
    const payload = await verifier.verify(token);
    console.log("Token is valid. Payload:", payload);
    return payload;
  } catch {
    console.log("Token is invalid");
    throw 'Token is invalid.';
  }
}

async function getDenyPolicy(methodArn) {
  return generatePolicy('user', 'Deny', methodArn);
}

async function parseToken(headers, authorization) {
  let response = { 'valid': false };

  if (!headers?.Authorization || headers.Authorization === 'None') {
    return response;
  }

  const authHeader = authorization.split(' ');

  // Deny request if the authorization header is not present
  // or the header does not have the Bearer token and the
  // first string is not 'Bearer'
  if (authHeader.length !== 2 || authHeader[0] !== 'Bearer') {
    return response;
  }

  return {
    valid: true,
    token: authHeader[1]
  };
}

// Help function to generate an IAM policy
function generatePolicy(principalId, effect, methodArn, verifier) {
  logger.debug('principalId', principalId);
  let authResponse = {};

  // Set principal Id
  authResponse.principalId = principalId;
  if (effect && methodArn) {
    let policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    let statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = methodArn;
    policyDocument.Statement[0] = statementOne;

    // Set Policy Document
    authResponse.policyDocument = policyDocument;
  }

  return authResponse;
};

function handleContextAndAPIKey(authResponse, permissionObject, headers) {
  // Optional output with custom properties of the String, Number or Boolean type.
  // Set the context
  authResponse.context = {
    isAdmin: false,
    userID: 'userid',
    role: ['public']
  };

  logger.debug('authResponse', JSON.stringify(authResponse));
  return authResponse;
};