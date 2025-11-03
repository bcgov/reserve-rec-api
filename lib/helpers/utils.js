const { createLogger, format, transports } = require("winston");
const { combine, timestamp } = format;
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const ssm = require('aws-cdk-lib/aws-ssm');
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { CfnOutput } = require('aws-cdk-lib');

// Default region if not set in environment
const CDK_DEFAULT_REGION = process.env.CDK_DEFAULT_REGION || 'ca-central-1';

// Initialize Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || CDK_DEFAULT_REGION });

// Initialize SSM client
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || CDK_DEFAULT_REGION });

// Logger configuration
const LEVEL = process.env.LOG_LEVEL || "error";

const logger = createLogger({
  level: LEVEL,
  format: combine(
    timestamp(),
    format.printf((info) => {
      let meta = "";
      let symbols = Object.getOwnPropertySymbols(info);
      if (symbols.length == 2) {
        meta = JSON.stringify(info[symbols[1]]);
      }
      let levelText = [info.level.toUpperCase()];
      switch (info.level) {
        case 'info':
          levelText = '\x1b[36m' + levelText + '\x1b[0m'; // cyan
          break;
        case 'debug':
          levelText = '\x1b[35m' + levelText + '\x1b[0m'; // magenta
          break;
        default:
          break;
      }
      let message = `${info.timestamp} ${levelText}: ${info.message
        } ${meta}`;
      if (info.level === 'error') {
        message = `\n\x1b[31m${message}\x1b[0m\n`;
      }
      if (info.level === 'warn') {
        message = `\x1b[33m${message}\x1b[0m`;
      }
      return message;
    })
  ),
  transports: [new transports.Console()],
});

async function getSyncSecretFromSM(scope, secret) {
  try {
    logger.debug(`Fetching Secrets Manager secret: ${secret.path}`);
    if (scope.getDeploymentName() !== 'prod') {
      const command = new GetSecretValueCommand({ SecretId: secret.path });
      const retrievedSecret = await secretsClient.send(command);
      return retrievedSecret.SecretString;
    } else {
      throw 'Synchronous secret retrieval is not implemented for prod';
    }
  } catch (error) {
    // If running offline, just return the secret name for local testing
    if (scope.isOffline()) {
      logger.warn(`Error retrieving secret ${secret.path} from Secrets Manager:\n ${error}`);
    }
    return secret.id;
  }
}

function setSSMParameter(scope, paramName, paramValue, description = null) {
  if (!description) {
    description = `Parameter ${paramName} for ${scope.getAppName()} - ${scope.getDeploymentName()} environment`;
  }
  return new ssm.StringParameter(scope, `${paramName}-SSMParameter`, {
    parameterName: paramName,
    stringValue: paramValue,
    description: description
  })
}

function getAsyncSecretFromSM(scope, secretsecretPath) {
  try {
    logger.debug(`Fetching Secrets Manager secret: ${secretPath}`);
    const secret = Secret.fromSecretNameV2(scope, constructNamer(secretName, context), secretPath);
    if (context?.ENVIRONMENT_NAME !== 'prod') {
      return secret.secretValue;
    }
  } catch (error) {
    // If running offline, just return the secret name for local testing
    if (context.IS_OFFLINE !== 'true') {
      logger.warn(`Error retrieving secret ${secretPath} from Secrets Manager:\n ${error}`);
    }
    return secretName;
  }
}


// Function to get context parameters from SSM Parameter Store
async function getParameterFromSSM(paramName) {
  logger.debug(`Fetching SSM env parameter: ${paramName}`);
  const command = new GetParameterCommand({ Name: paramName, WithDecryption: true });
  try {
    const response = await ssmClient.send(command);
    return response.Parameter.Value;
  } catch (error) {
    throw `SSM GET error.\n ${error}`;
  }
}

function constructNamer(refName, { appName, deploymentName, stackName } = {}) {
  const parts = [appName, deploymentName, stackName, refName];
  if (parts.some(part => !part)) {
    throw new Error(`Missing required parts to construct name: ${JSON.stringify(parts)}`);
  }
  return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1).join(''));
}



module.exports = {
  constructNamer,
  getParameterFromSSM,
  getSyncSecretFromSM,
  setSSMParameter,
  logger
};