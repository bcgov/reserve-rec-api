'use strict';

const { logger } = require('/opt/base');
const { CognitoJwtVerifier } = require('aws-jwt-verify');

/**
 * Lambda authorizer for WebSocket $connect route.
 *
 * Validates the Cognito JWT passed as a query parameter:
 *   wss://<endpoint>?token=<jwt>&queueId=<queueId>
 *
 * Returns ALLOW policy with { cognitoSub, queueId } in the authorizer context,
 * which is available to the $connect handler via event.requestContext.authorizer.
 */
exports.handler = async (event) => {
  logger.debug('WebSocket authorizer event:', JSON.stringify(event));

  const token = event.queryStringParameters?.token;
  const queueId = event.queryStringParameters?.queueId;
  const methodArn = event.methodArn;

  if (!token) {
    logger.info('WebSocket auth: no token in query string');
    throw new Error('Unauthorized');
  }

  if (!queueId) {
    logger.info('WebSocket auth: no queueId in query string');
    throw new Error('Unauthorized');
  }

  const userPoolId = process.env.PUBLIC_USER_POOL_ID;
  const clientId = process.env.PUBLIC_USER_POOL_CLIENT_ID;

  if (!userPoolId || !clientId) {
    logger.error('WebSocket auth: PUBLIC_USER_POOL_ID or PUBLIC_USER_POOL_CLIENT_ID not configured');
    throw new Error('Unauthorized');
  }

  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  });

  let payload;
  try {
    payload = await verifier.verify(token);
  } catch (err) {
    logger.info('WebSocket auth: token validation failed:', err.message);
    throw new Error('Unauthorized');
  }

  const cognitoSub = payload.sub;
  logger.info(`WebSocket auth: authorized ${cognitoSub} for queue ${queueId}`);

  return {
    principalId: cognitoSub,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: methodArn,
        },
      ],
    },
    context: {
      cognitoSub,
      queueId,
    },
  };
};
