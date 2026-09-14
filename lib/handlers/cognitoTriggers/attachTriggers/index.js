const {
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
  UpdateUserPoolCommand,
} = require('@aws-sdk/client-cognito-identity-provider');

const cognito = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

/**
 * Every field UpdateUserPool accepts. Anything set on the pool and NOT passed
 * back is reset to its default — the API replaces the whole configuration
 * rather than patching it.
 *
 * This list is the reason this custom resource exists. The previous
 * implementation called updateUserPool with UserPoolId and LambdaConfig alone,
 * which silently cleared AutoVerifiedAttributes on dev and test the first time
 * it re-ran, and was rejected outright in prod because the resulting state was
 * invalid. Cognito's own console sends all of these on every save.
 */
const PRESERVED_FIELDS = [
  'Policies',
  'DeletionProtection',
  'AutoVerifiedAttributes',
  'SmsVerificationMessage',
  'EmailVerificationMessage',
  'EmailVerificationSubject',
  'VerificationMessageTemplate',
  'SmsAuthenticationMessage',
  'UserAttributeUpdateSettings',
  'MfaConfiguration',
  'DeviceConfiguration',
  'EmailConfiguration',
  'SmsConfiguration',
  'UserPoolTags',
  'AdminCreateUserConfig',
  'UserPoolAddOns',
  'AccountRecoverySetting',
];

function isEmpty(value) {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Build an UpdateUserPool request that changes only the triggers.
 *
 * @param {object} pool - the pool as DescribeUserPool returns it
 * @param {object} triggers - {TriggerName: lambdaArn}; a null arn removes one
 */
function buildUpdate(pool, triggers) {
  const request = { UserPoolId: pool.Id };

  for (const field of PRESERVED_FIELDS) {
    if (!isEmpty(pool[field])) request[field] = pool[field];
  }

  // Merge rather than replace: another stack may own a trigger this one does
  // not know about, and clobbering it is the bug this resource exists to avoid.
  const lambdaConfig = { ...(pool.LambdaConfig || {}) };
  for (const [name, arn] of Object.entries(triggers || {})) {
    if (arn) lambdaConfig[name] = arn;
    else delete lambdaConfig[name];
  }
  if (!isEmpty(lambdaConfig)) request.LambdaConfig = lambdaConfig;

  // Returned by DescribeUserPool but rejected on the way back in.
  if (request.Policies) delete request.Policies.SignInPolicy;

  return request;
}

exports.handler = async (event) => {
  const { RequestType, ResourceProperties } = event;
  const userPoolId = ResourceProperties.UserPoolId;
  const triggers = ResourceProperties.Triggers || {};

  // Deliberately a no-op on delete. Detaching triggers during a teardown would
  // strip them from a pool that outlives this stack, and the pool is owned
  // elsewhere.
  if (RequestType === 'Delete') {
    return { PhysicalResourceId: `${userPoolId}-cognito-triggers` };
  }

  const { UserPool: pool } = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: userPoolId })
  );

  const request = buildUpdate(pool, triggers);
  await cognito.send(new UpdateUserPoolCommand(request));

  // Read back rather than trust the write: this resource exists because a
  // successful-looking call quietly changed things it was not asked to.
  const { UserPool: after } = await cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: userPoolId })
  );

  const lost = PRESERVED_FIELDS.filter(
    (f) => !isEmpty(pool[f]) && isEmpty(after[f])
  );
  if (lost.length) {
    throw new Error(
      `UpdateUserPool cleared fields it was asked to preserve: ${lost.join(', ')}`
    );
  }

  const missing = Object.entries(triggers)
    .filter(([name, arn]) => arn && after.LambdaConfig?.[name] !== arn)
    .map(([name]) => name);
  if (missing.length) {
    throw new Error(`triggers not attached: ${missing.join(', ')}`);
  }

  return {
    PhysicalResourceId: `${userPoolId}-cognito-triggers`,
    Data: { Triggers: Object.keys(after.LambdaConfig || {}).join(',') },
  };
};

exports.buildUpdate = buildUpdate;
