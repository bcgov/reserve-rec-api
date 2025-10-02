const { logger } = require('/opt/base');

async function authorizeAll(event) {
  const arnPrefix = event.methodArn.split(':').slice(0, 6);
  const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
  const apiIDString = arnPrefix[5];
  const apiString = apiIDString.split('/')[0];
  const fullAPIMethods = joinedArnPrefix + ':' + apiString + '/' + process.env.API_STAGE + '/*';
  console.log("fullAPIMethods:", fullAPIMethods);
  return generatePolicy('pub', 'Allow', fullAPIMethods);
}

// Help function to generate an IAM policy
function generatePolicy(principalId, effect, methodArn) {
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

async function getDenyPolicy(methodArn) {
  return generatePolicy('user', 'Deny', methodArn);
}

async function validateToken(verifier, token) {
  try {
    const payload = await verifier.verify(token);
    console.log("Token is valid.");
    return payload;
  } catch {
    console.log("Token is invalid");
    throw 'Token is invalid.';
  }
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

module.exports = {
  authorizeAll,
  generatePolicy,
  getDenyPolicy,
  getUserData,
  handleContextAndAPIKey,
  parseToken,
  validateToken,
};