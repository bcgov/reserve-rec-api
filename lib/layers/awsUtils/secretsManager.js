const {
  GetSecretValueCommand,
  SecretsManagerClient
} = require('@aws-sdk/client-secrets-manager');

const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const smClient = new SecretsManagerClient({ region: AWS_REGION });

async function getSecretValue(secretName = "SECRET_NAME") {
  // if offline (local), look at the env to see if the secret is there
  if (process.env.IS_OFFLINE) {
    return process.env[secretName];
  }
  // Else check the secrets manager
  const response = await smClient.send(new GetSecretValueCommand({ SecretId: secretName }));
  if (response.SecretString) {
    return JSON.parse(response.SecretString);
  }
}

module.exports = {
  getSecretValue
}