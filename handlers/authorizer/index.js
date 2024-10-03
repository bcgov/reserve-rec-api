const { logger } = require('/opt/base');
const TABLE_NAME = process.env.TABLE_NAME;
const jwt = require('jsonwebtoken');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');

exports.handler = async function (event, context, callback) {
  console.log(event);
  logger.debug('event', JSON.stringify(event));

  // TODO: use methodARN to get the policy
  // const policy = generatePolicy('public', 'Allow', '');
  // console.log(policy);
  // return policy;

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
    const claims = validateToken(tokenData.token);
    console.log("claims", claims);

    const groups = claims['cognito:groups'];

    console.log("groups", groups);

    let methodArn = `arn:aws:execute-api:ca-central-1:637423314715:6kbrprs1r7/api/*`;
    const arnPrefix = methodArn.split(':').slice(0, 6);
    const joinedArnPrefix = arnPrefix.slice(0, 5).join(':');
    const apiIDString = arnPrefix[5];
    const apiString = apiIDString.split('/')[0];
    const fullAPIMethods = joinedArnPrefix + ':' +apiString + '/' + process.env.STAGE_NAME + '/*';

    return generatePolicy(claims.sid, 'Allow', fullAPIMethods);

    // const results = batchQueryWrapper(TABLE_NAME, 'group', groups);

    // console.log(results);

    // if (results.length > 0) {
    //   const policy = {
    //     Version: results[0].policy.Version,
    //     Statement: []
    //   };

    //   results.forEach(item => {
    //     policy.Statement = policy.Statement.concat(item.policy.Statement);
    //   });

    //   return generatePolicy(claims.sid, 'Allow', event.methodArn);
    // }
  } catch (e) {
    logger.error(JSON.stringify(e));
  }

  console.log("Deny");
  return getDenyPolicy(event.methodArn);
};

async function batchQueryWrapper(tableName, key, values) {
  const dynamodb = new DynamoDBClient();
  let results = [];
  const valuesList = [];

  for (let i = 0; i < values.length; i += 25) {
    valuesList.push(values.slice(i, i + 25));
  }

  for (const vlist of valuesList) {
    const params = {
      RequestItems: {
        [tableName]: {
          Keys: vlist.map(val => ({ [key]: val }))
        }
      }
    };

    let response = await dynamodb.batchGet(params).promise();
    results = results.concat(response.Responses[tableName]);

    while (response.UnprocessedKeys && Object.keys(response.UnprocessedKeys).length) {
      response = await dynamodb.batchGet({ RequestItems: response.UnprocessedKeys }).promise();
      results = results.concat(response.Responses[tableName]);
    }
  }

  return results;
}

async function validateToken(token) {
  const headers = jwt.decode(token, { complete: true }).header;
  const kid = headers.kid;

  // search for the kid in the downloaded public keys
  let keyIndex = -1;
  for (let i = 0; i < keys.length; i++) {
    if (kid === keys[i].kid) {
      keyIndex = i;
      break;
    }
  }

  if (keyIndex === -1) {
    console.log('Public key not found in jwks.json');
    throw 'Public key not found in jwks.json';
  }

  // construct the public key
  const publicKey = jwkToPem(keys[keyIndex]);

  // get the last two sections of the token,
  // message and signature (encoded in base64)
  const [message, encodedSignature] = token.split('.').slice(0, 2);

  // decode the signature
  const decodedSignature = Buffer.from(encodedSignature, 'base64');

  // verify the signature
  const verify = crypto.createVerify('SHA256');
  verify.update(message);
  verify.end();
  if (!verify.verify(publicKey, decodedSignature)) {
    console.log('Signature verification failed');
    throw 'Signature verification failed';
  }

  console.log('Signature successfully verified');

  // since we passed the verification, we can now safely
  // use the unverified claims
  const claims = jwt.decode(token);

  // additionally we can verify the token expiration
  if (Date.now() / 1000 > claims.exp) {
    console.log('Token is expired');
    throw 'Token is expired';
  }

  // and the Audience  (use claims['client_id'] if verifying an access token)
  if (claims.client_id !== COGNITO_APP_CLIENT_ID) {
    console.log('Token was not issued for this audience');
    throw 'Token was not issued for this audience';
  }

  // now we can use the claims
  console.log(claims);
  return claims;
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
let generatePolicy = function (principalId, effect, methodArn) {
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
