'use strict';

// Settings read from SSM at deploy into Lambda environment variables. The
// parameters are created by hand before a deploy; CDK only reads them.
const SETTINGS = {
  cancellationEmailEnabled: 'CANCELLATION_EMAIL_ENABLED',
  duplicateEmailRefuse: 'DUPLICATE_EMAIL_REFUSE',
  holdLimitsEnabled: 'HOLD_LIMITS_ENABLED',
  holdLimits: 'HOLD_LIMITS',
};

function settingParam(env, name) {
  if (!SETTINGS[name]) {
    throw new Error(`Unknown setting "${name}"`);
  }
  return `/reserveRecApi/${env}/settings/${name}`;
}

/**
 * Environment variables for the named settings, each resolved from its
 * parameter by `stack` (a BaseStack).
 */
function settingsEnvironment(stack, names) {
  return Object.fromEntries(names.map((name) => [
    SETTINGS[name],
    stack.resolveReference(stack, settingParam(stack.getDeploymentName(), name)),
  ]));
}

module.exports = {
  SETTINGS,
  settingParam,
  settingsEnvironment,
};
