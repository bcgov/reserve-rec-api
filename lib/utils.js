
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const ssm = require('aws-cdk-lib/aws-ssm');
const { CfnOutput } = require('aws-cdk-lib');
const { Construct } = require('constructs');
const { Secret } = require("aws-cdk-lib/aws-secretsmanager");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { LambdaLayerVersion } = require('aws-cdk-lib/aws-lambda');
const { createLogger, format, transports } = require("winston");
const { combine, timestamp } = format;

// Default region if not set in environment
const CDK_DEFAULT_REGION = process.env.CDK_DEFAULT_REGION || 'ca-central-1';

// Initialize SSM client
const ssmClient = new SSMClient({ region: process.env.AWS_REGION || CDK_DEFAULT_REGION });

// Initialize Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || CDK_DEFAULT_REGION });

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
        case 'warn':
          levelText = '\x1b[33m' + levelText + '\x1b[0m'; // yellow
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
      return message;
    })
  ),
  transports: [new transports.Console()],
});

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

/**
 * Retrieves a secret value from AWS Secrets Manager synchronously for non-production environments.
 * In production, synchronous retrieval is not implemented and will throw an error.
 * If an error occurs and running offline, returns the secret name for local testing.
 *
 * @async
 * @param {string} secretName - The name of the secret to retrieve.
 * @param {Object} context - The context object containing environment information.
 * @param {string} [context.ENVIRONMENT_NAME] - The name of the current environment (e.g., 'prod').
 * @param {string} [context.IS_OFFLINE] - Indicates if the function is running offline ('true' or 'false').
 * @returns {Promise<string>} The secret value as a string, or the secret name if retrieval fails.
 * @throws Will throw an error if synchronous secret retrieval is attempted in production.
 */
async function getSyncSecretFromSM(secretName, context) {
  const secretPath = exportNamer(secretName, context);
  try {
    logger.debug(`Fetching Secrets Manager secret: ${secretPath}`);
    if (context?.ENVIRONMENT_NAME !== 'prod') {
      const command = new GetSecretValueCommand({ SecretId: secretPath });
      const secret = await secretsClient.send(command);
      return secret.SecretString;
    } else {
      throw 'Synchronous secret retrieval is not implemented for prod';
    }
  } catch (error) {
    // If running offline, just return the secret name for local testing
    if (context.IS_OFFLINE !== 'true') {
      logger.warn(`Error retrieving secret ${secretPath} from Secrets Manager:\n ${error}`);
    }
    return secretName;
  }
}

// Function to get context secrets from SSM Parameter Store and return them as a token
// (Currently not used, but could be useful for future secret management)
function getAsyncSecretFromSM(scope, secretName, context) {
  const secretPath = exportNamer(secretName, context);
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

// Specific function to get environment config from SSM (JSON parsed)
async function getContextFromSSM(stackName, props) {

  // If context is not set or running offline, attempt to load env vars
  // from local env.json file
  let context = {};
  if (props?.ENVIRONMENT_NAME === 'local' || props.IS_OFFLINE === 'true') {
    try {
      logger.debug(`Running offline.`);
      if (props?.LOCAL_CONTEXT_PATH) {
        logger.debug(`Loading local context file from path: ${props?.LOCAL_CONTEXT_PATH}`);
        // Load and parse local context file - note, the file path is relative to whichever file calls this function
        context = require(props?.LOCAL_CONTEXT_PATH);
      }
    } catch (error) {
      logger.warn(`Did not load local context file.`);
      logger.debug(error);
    }
  } else {

    // Otherwise fetch environment-specific configuration from SSM Parameter Store
    // Store the config in a parameter named: /{appName}/{environmentName}/{stackName}/{configParamName}
    let paramPath = '';
    try {
      paramPath = exportNamer(props?.CONSTANTS?.SSM_CONTEXT_PARAM_NAME, {
        STACK_NAME: stackName,
        ...props
      });
      const contextJsonString = await getParameterFromSSM(paramPath);
      context = JSON.parse(contextJsonString);
      logger.debug('Context: ', context);
    } catch (error) {
      throw `Error fetching context configuration from SSM (context: ${context?.SSM_CONTEXT_PARAM_NAME}):\n ${error}`;
    }
  }

  return context;
}

function importLayerFromSSM(scope, layerName, context) {
  const layerPath = buildSSMPath(context.APP_NAME, context.STACK_NAMES.CORE_STACK_NAME, context.ENVIRONMENT_NAME, layerName, 'layerVersionArn');
  const layerArn = ssm.StringParameter.valueForStringParameter(scope, layerPath);
  logger.debug(`Importing Lambda Layer ${layerName} from SSM Parameter: ${layerPath} (ARN: ${layerArn})`);
  return LambdaLayerVersion.fromLayerVersionArn(scope, constructNamer(layerName, context), layerArn);
}


function buildSSMPath(appName, stackName, environmentName, constructName = null, exportedConstructProp = null) {
  let path = `/${appName}/${stackName}/${environmentName}`;
  if (constructName) {
    path += `/${constructName}`;
  } if (exportedConstructProp) {
    path += `/${exportedConstructProp}`;
  }
  return path;
}

// function to create standardized resource names
// Names are PascalCase concatenated strings of the form: {AppName}{EnvironmentName}{StackName}{ConstructName}
function exportNamer(refName, props) {
  const dl = props?.isCfnOutput ? '-' : '/';
  let pathArray = [props?.CONSTANTS?.APP_NAME, props?.ENVIRONMENT_NAME, props?.STACK_NAME];
  if (props?.[refName]) {
    pathArray.push(props?.[refName]);
  } else if (refName) {
    pathArray.push(refName);
  }
  if (props?.pathSuffix) {
    pathArray.push(props.pathSuffix);
  }
  for (const part of pathArray) {
    if (!part) {
      let msg = `exportNamer: Missing required property to construct name. Provided: STACK_NAME=${props?.STACK_NAME}, ENVIRONMENT_NAME=${props?.ENVIRONMENT_NAME}`;
      if (props?.[refName]) {
        msg += `, refName=${props?.[refName]}`;
      } else if (refName) {
        msg += `, refName=${refName}`;
      }
      if (props?.pathSuffix) {
        msg += `, pathSuffix=${props.pathSuffix}`;
      }
      throw new Error(msg);
    }
  }
  let exportName = pathArray.map(part => part?.charAt(0).toLowerCase() + part?.slice(1)).join(dl);
  if (!props?.isCfnOutput) {
    exportName = '/'.concat(exportName);
  }
  return exportName;
}


function stackNamer(stackName, props) {
  return `${stackName}-${props?.ENVIRONMENT_NAME?.charAt(0).toUpperCase() + props?.ENVIRONMENT_NAME?.slice(1)}`;
}

function constructNamer(refName, props) {
  let parts = [props?.STACK_NAME, props?.ENVIRONMENT_NAME, refName];
  // Should not have any undefined parts.
  for (const part of parts) {
    if (!part) {
      throw new Error(`constructNamer: Missing required property to construct name. Provided: STACK_NAME=${props?.STACK_NAME}, ENVIRONMENT_NAME=${props?.ENVIRONMENT_NAME}, constructName=${refName}`);
    }
  }
  return parts.map(part => part?.charAt(0).toUpperCase() + part?.slice(1)).join('-');
}

function exportToSSM(scope, baseName, props) {
  const ssmParamName = constructNamer(`${baseName}-SSMParam`, props);
  const ssmParamPath = exportNamer(baseName, props);
  new ssm.StringParameter(scope, ssmParamName, {
    parameterName: ssmParamPath,
    stringValue: props?.value,
    description: `SSM Parameter for ${baseName} created by ${props.STACK_NAME} stack`
  });
  logger.debug(`Exporting new ${baseName} to SSM Parameter: ${ssmParamPath}`);
  return ssmParamPath;
}

function exportToCfnOutput(scope, baseName, props) {
  const exportName = exportNamer(baseName, {
    isCfnOutput: true,
    pathSuffix: props?.pathSuffix,
    ...props
  });
  new CfnOutput(scope, constructNamer(`${baseName}-CfnOutput`, props), {
    exportName: exportName,
    value: props?.value,
    description: `CloudFormation Output for ${baseName} created by ${props.STACK_NAME}-${props.ENVIRONMENT_NAME} stack`
  });
  logger.debug(`Exporting new ${baseName} to CloudFormation Output: ${exportNamer(baseName, props)}`);
  return exportName;
}

function exportValue(scope, baseName, props) {
    exportToSSM(scope, baseName, props)
    exportToCfnOutput(scope, baseName, props)
  }

function resolveConstruct(baseName, { createFn = () => null, importFn = () => null, ...props }) {
  const constructName = props?.constructNameOverride || constructNamer(baseName, props);
  let construct = {};
  // TODO: Consider if we want to support import function in addition to create function
  try {
    logger.debug(`Creating new construct for ${constructName}`);
    construct = createFn(constructName);
  } catch (error) {
    throw error;
  }
  return construct;
}

function createConstruct(scope, baseName, { createFn = () => null, importFn = () => null, exportFn = () => null, ...props }) {
  try {
    // Resolve the construct using either the create function or import functions
    let construct = resolveConstruct(baseName, { createFn, importFn, ...props });

    // If an export function is provided, export the construct using the provided export function
    if (exportFn) {
      exportFn(construct);
    }

    // return the created construct
    return construct;
  } catch (error) {
    throw new Error(`Error creating construct ${baseName}: \n ${error}`);
  }
}

function sanitizeProps(props) {
  let sanitized = { ...props };
  // Delete empty properties
  Object.keys(sanitized).forEach(key => {
    if (sanitized[key] === undefined || sanitized[key] === null || sanitized[key] === '') {
      delete sanitized[key];
    }
  });

  // Remove all secrets
  delete sanitized?.secrets;

  // Remove large or sensitive properties from the props before passing to Lambda environment
  delete sanitized?.CONSTANTS;
  delete sanitized?.SSM_CONTEXT_PARAM_NAME;
  delete sanitized?.LOCAL_CONTEXT_PATH;

  // Delete reserved AWS CDK properties
  delete sanitized?.AWS_REGION;

  // Remove all Constructs to prevent circular references
  for (const [key, value] of Object.entries(sanitized)) {
    if (value instanceof Construct) {
      delete sanitized[key];
    }
  }

  // Covert non-string properties to strings (how environment variables are expected)
  for (const key of Object.keys(sanitized)) {
    if (typeof sanitized[key] !== 'string') {
      sanitized[key] = JSON.stringify(sanitized[key]);
    }
  }

  return sanitized;
}


module.exports = {
  constructNamer,
  createConstruct,
  exportNamer,
  exportValue,
  exportToCfnOutput,
  exportToSSM,
  getAsyncSecretFromSM,
  getContextFromSSM,
  getParameterFromSSM,
  getSyncSecretFromSM,
  importLayerFromSSM,
  logger,
  sanitizeProps,
  stackNamer
};