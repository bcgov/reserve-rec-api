const {
  GetSecretValueCommand,
  SecretsManagerClient
} = require('@aws-sdk/client-secrets-manager');
const { logger } = require('/opt/base');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const smClient = new SecretsManagerClient({ region: AWS_REGION });

async function getSecretValue(secretName = "SECRET_NAME") {
  // if offline (local), look at the env to see if the secret is there
  try {

    if (process.env.IS_OFFLINE === 'true') {
      logger.debug(`OFFLINE: Getting secret value for ${secretName} from environment`);
      return process.env[secretName];
    }
    // Else check the secrets manager
    logger.debug(`Getting secret value for ${secretName} from Secrets Manager`);
    const response = await smClient.send(new GetSecretValueCommand({ SecretId: secretName }));
    if (response.SecretString) {
      return JSON.parse(response.SecretString);
    }
    return response;
  } catch (error) {
    logger.error(`Error getting secret value for ${secretName}`, error);
    throw
  }
}

module.exports = {
  getSecretValue
}