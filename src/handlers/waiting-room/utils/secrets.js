'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ca-central-1' });

// Cache the secret value per ARN to avoid redundant Secrets Manager calls within a Lambda invocation
const cache = new Map();

/**
 * Retrieves a secret value from Secrets Manager, caching it for the Lambda invocation lifetime.
 *
 * @param {string} secretArn - ARN of the secret
 * @returns {Promise<string>} Secret string value
 */
async function getSecret(secretArn) {
  if (cache.has(secretArn)) {
    return cache.get(secretArn);
  }
  const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn }));
  const value = response.SecretString;
  cache.set(secretArn, value);
  return value;
}

/**
 * Retrieves the HMAC signing key from Secrets Manager.
 * Uses HMAC_SIGNING_KEY_ARN environment variable.
 */
async function getHmacSigningKey() {
  const arn = process.env.HMAC_SIGNING_KEY_ARN;
  if (!arn) throw new Error('HMAC_SIGNING_KEY_ARN environment variable not set');
  return getSecret(arn);
}

// For testing — allows cache clearing between test runs
function _clearCache() {
  cache.clear();
}

module.exports = { getSecret, getHmacSigningKey, _clearCache };
