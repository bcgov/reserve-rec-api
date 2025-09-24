// The application name. This should not be changed as it is part of the SSM Parameter path.
const APP_NAME = 'ReserveRecApi';

// Path to local environment configuration file for offline/local development
const LOCAL_CONTEXT_PATH = './local-context.json';

// Name of the SSM Parameter that holds environment-specific configuration
const SSM_CONTEXT_PARAM_NAME = 'context';

// The stack names. These should not be changed as they are part of the SSM Parameter path.
const STACK_NAMES = {
  ADMIN_IDENTITY_STACK: 'AdminIdentityStack',
  PUBLIC_IDENTITY_STACK: 'PublicIdentityStack'
}

// Suffix to append to construct names when exporting to SSM Parameter Store
const SSM_SUFFIX = 'SSMParam';

module.exports = {
  APP_NAME,
  LOCAL_CONTEXT_PATH,
  SSM_CONTEXT_PARAM_NAME,
  SSM_SUFFIX,
  STACK_NAMES
}
