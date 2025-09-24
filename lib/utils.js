
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");
const ssm = require('aws-cdk-lib/aws-ssm');
const { Secret } = require("aws-cdk-lib/aws-secretsmanager");
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");
const { APP_NAME, LOCAL_CONTEXT_PATH, SSM_SUFFIX } = require('./constants');
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
      return `${info.timestamp} ${[info.level.toUpperCase()]}: ${info.message
        } ${meta}`;
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
async function getContextFromSSM(stackName, appContext) {

  // If context is not set or running offline, attempt to load env vars
  // from local env.json file
  let context = {};
  if (appContext?.ENVIRONMENT_NAME === 'local' || appContext.IS_OFFLINE === 'true') {
    try {
      logger.debug(`Running offline. Loading environment context from ${LOCAL_CONTEXT_PATH} file`);
      // Load and parse local context file - note, the file path is relative to whichever file calls this function
      context = require(LOCAL_CONTEXT_PATH);
    } catch (error) {
      logger.error(`Error loading ${LOCAL_CONTEXT_PATH} file:`, error);
    }
  } else {

    // Otherwise fetch environment-specific configuration from SSM Parameter Store
    // Store the config in a parameter named: /{appName}/{environmentName}/{stackName}/{configParamName}
    try {
      const contextJsonString = await getParameterFromSSM(`/${APP_NAME}/${stackName}/${appContext?.ENVIRONMENT_NAME}/${appContext?.SSM_CONTEXT_PARAM_NAME}`);
      context = JSON.parse(contextJsonString);
      logger.debug('Context: ', context);
    } catch (error) {
      throw `Error fetching context configuration from SSM (context: ${context?.SSM_CONTEXT_PARAM_NAME}):\n ${error}`;
    }
  }

  return context;
}
// function to create standardized resource names
// Names are PascalCase concatenated strings of the form: {AppName}{EnvironmentName}{StackName}{ConstructName}
function exportNamer(refName, context, exportedConstructProp = null) {
  let path = `/${APP_NAME}/${context?.STACK_NAME}/${context?.ENVIRONMENT_NAME}`;
  if (context?.[refName]) {
    path += `/${context?.[refName]}`;
  } else if (refName) {
    path += `/${refName}`;
  }
  if (exportedConstructProp) {
    path += `/${exportedConstructProp}`;
  }
  return path;
}

function stackNamer(stackName, context) {
  return `${stackName}-${context?.ENVIRONMENT_NAME?.charAt(0).toUpperCase() + context?.ENVIRONMENT_NAME?.slice(1)}`;
}

function constructNamer(refName, context) {
  let parts = [context.STACK_NAME, context.ENVIRONMENT_NAME, refName];
  return parts.map(part => part?.charAt(0).toUpperCase() + part?.slice(1)).join('-');
}

function exportToSSM(scope, refName, value, suffix = null, context) {
  const ssmParamName = constructNamer(`${context?.[refName]}-SSMParam`, context);
  const ssmParamPath = exportNamer(refName, context, suffix);
  new ssm.StringParameter(scope, ssmParamName, {
    parameterName: ssmParamPath,
    stringValue: value,
    description: `SSM Parameter for ${refName} created by ${context.STACK_NAME} stack`
  });
  logger.debug(`Exporting new ${refName} to SSM Parameter: ${ssmParamPath}`);
}


/**
 * Creates or imports a construct based on the provided context and functions.
 *
 * This utility handles standardized naming, context-based overrides, and optional export logic.
 * If an override is specified in the context, it attempts to import the construct using the import function.
 * Otherwise, it creates a new construct using the create function.
 * Optionally, the construct can be exported using the export function.
 *
 * @param {Object} scope - The scope in which to create or import the construct.
 * @param {string} nameKey - The key used to identify and name the construct.
 * @param {Object} context - Context object containing configuration, overrides, and naming information.
 * @param {Function} createFn - Function to create a new construct. Receives the construct name as an argument.
 * @param {Function} [importFn=null] - Optional function to import an existing construct. Receives the construct name and import reference.
 * @param {Function} [exportFn=null] - Optional function to export the construct. Receives the construct as an argument.
 * @returns {Object|null} The created or imported construct, or null if import errors are ignored.
 * @throws {string} If construct creation or import fails and errors are not ignored.
 */
function createConstruct(scope, nameKey, context, createFn, importFn = null, exportFn = null) {
  try {
    // In some cases, there are character limits on construct names (e.g. Cognito User Pool Domains)
    // In these cases, we allow the context to provide a specific name for the construct
    // Otherwise, we generate a standardized name using the constructNamer function
    let constructName = nameKey;
    // If context contains a name for the construct, use that to
    // Create standardized construct name from context
    if (context?.[nameKey]) {
      constructName = constructNamer(context?.[nameKey], context);
    }
    // Initialize construct variable
    let construct = null;

    // Check for construct override in context
    const overrides = context?.SSM_CONSTRUCT_OVERRIDES || {};
    if (overrides[nameKey]) {
      // If override exists, import the construct using the provided import function
      try {
        logger.debug(`Importing existing construct for ${nameKey} using reference: ${overrides[nameKey]}`);
        // Fetch the SSM parameter value to use as the import reference
        const ssmParam = ssm.StringParameter.valueForStringParameter(scope, overrides[nameKey]);
        // Import the existing construct using the provided import function
        construct = importFn(constructName, ssmParam);
      } catch (error) {
        const errorMsg = `Error importing construct ${nameKey} with reference ${overrides[nameKey]}: ${error}`;
        if (context?.IGNORE_CONSTRUCT_IMPORT_ERRORS === 'true') {
          logger.warn(errorMsg);
          return null;
        } else {
          throw errorMsg;
        }
      }
    } else {
      // Otherwise, create a new construct using the provided create function
      try {
        logger.debug(`Creating new construct for ${nameKey}`);
        construct = createFn(constructName);
      } catch (error) {
        throw error;
      }
    }

    // If an export function is provided, export the construct using the provided export function
    if (exportFn) {
      exportFn(construct);
    }

    // return the created construct
    return construct;
  } catch (error) {
    throw `Error creating construct ${nameKey}: \n ${error}`;
  }
}


module.exports = {
  constructNamer,
  createConstruct,
  exportNamer,
  exportToSSM,
  getAsyncSecretFromSM,
  getContextFromSSM,
  getParameterFromSSM,
  getSyncSecretFromSM,
  logger,
  stackNamer
};