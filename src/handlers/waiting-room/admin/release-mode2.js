'use strict';

const { Exception, logger, sendResponse, checkAuthContext } = require('/opt/base');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { getActiveMode2QueueId } = require('../utils/dynamodb');

let _lambdaClient;
function getLambdaClient() {
  if (!_lambdaClient) {
    _lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'ca-central-1' });
  }
  return _lambdaClient;
}

exports.handler = async (event) => {
  logger.info('WaitingRoom admin RELEASE-MODE2');

  try {
    checkAuthContext(event, 'superadmin');

    const releaseLambdaArn = process.env.RELEASE_LAMBDA_ARN;
    if (!releaseLambdaArn) {
      throw new Exception('RELEASE_LAMBDA_ARN not configured', { code: 503 });
    }

    const queueId = await getActiveMode2QueueId();
    if (!queueId) {
      throw new Exception('Mode 2 is not active', { code: 409 });
    }

    // Synchronously invoke the Release Lambda so we can return how many were admitted.
    // force=true bypasses the time gate — admin-triggered releases are manual overrides.
    const result = await getLambdaClient().send(new InvokeCommand({
      FunctionName: releaseLambdaArn,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ queueId, force: true })),
    }));

    const payload = JSON.parse(Buffer.from(result.Payload).toString());

    if (result.FunctionError) {
      logger.error('Release Lambda returned error:', payload);
      throw new Exception('Release Lambda failed', { code: 502 });
    }

    logger.info('Mode 2 manual release complete:', payload);

    return sendResponse(200, {
      queueId,
      admitted: payload.admitted ?? 0,
      result: payload.result,
    }, `Released ${payload.admitted ?? 0} user(s) from Mode 2 queue`);

  } catch (err) {
    logger.error('WaitingRoom RELEASE-MODE2 error:', err.message || err);
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message);
    }
    return sendResponse(500, null, 'Internal server error');
  }
};
