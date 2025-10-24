const { SSMClient, GetParameterCommand, GetParametersCommand } = require('@aws-sdk/client-ssm');
const { GetParametersByPathCommand } = require('@aws-sdk/client-ssm');

const ssmClient = new SSMClient({});

/**
 * Get a single parameter from SSM Parameter Store
 * @param {string} name - Parameter name
 * @param {boolean} withDecryption - Whether to decrypt secure string parameters
 * @returns {Promise<string>} Parameter value
 */
const getParameter = async (name, withDecryption = true) => {
  try {
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: withDecryption
    });

    const response = await ssmClient.send(command);
    return response.Parameter.Value;
  } catch (error) {
    throw new Error(`Failed to get parameter ${name}: ${error.message}`);
  }
};

/**
 * Get multiple parameters from SSM Parameter Store
 * @param {string[]} names - Array of parameter names
 * @param {boolean} withDecryption - Whether to decrypt secure string parameters
 * @returns {Promise<Object>} Object with parameter names as keys and values
 */
const getSSMParameters = async (names, withDecryption = true) => {
  try {
    const command = new GetParametersCommand({
      Names: names,
      WithDecryption: withDecryption
    });

    const response = await ssmClient.send(command);

    const parameters = {};
    response.Parameters.forEach(param => {
      parameters[param.Name] = param.Value;
    });

    return parameters;
  } catch (error) {
    throw new Error(`Failed to get parameters: ${error.message}`);
  }
};

/**
 * Get parameter by path from SSM Parameter Store
 * @param {string} path - Parameter path
 * @param {boolean} recursive - Whether to get parameters recursively
 * @param {boolean} withDecryption - Whether to decrypt secure string parameters
 * @returns {Promise<Object>} Object with parameter names as keys and values
 */
const getParametersByPath = async (path, recursive = true, withDecryption = true) => {
  try {
    const command = new GetParametersByPathCommand({
      Path: path,
      Recursive: recursive,
      WithDecryption: withDecryption
    });

    const response = await ssmClient.send(command);

    const parameters = {};
    response.Parameters.forEach(param => {
      parameters[param.Name] = param.Value;
    });

    return parameters;
  } catch (error) {
    throw new Error(`Failed to get parameters by path ${path}: ${error.message}`);
  }
};

module.exports = {
  getParameter,
  getSSMParameters,
  getParametersByPath
};