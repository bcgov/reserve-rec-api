#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const { createAdminIdentityStack } = require('../lib/admin-identity-stack/admin-identity-stack');
const { createPublicIdentityStack } = require('../lib/public-identity-stack/public-identity-stack');
const { APP_NAME, STACK_NAMES, LOCAL_CONTEXT_PATH, SSM_CONTEXT_PARAM_NAME } = require('../lib/constants');

// Main function to build the CDK app
async function buildApp() {
  console.log('Starting CDK application synthesis...');

  try {
    // Create the CDK application
    const app = new cdk.App();

    // Initialize context objects
    let context = {
      APP_NAME: APP_NAME, // The application name. This should not be changed as it is part of the SSM Parameter path.
      LOCAL_CONTEXT_PATH: LOCAL_CONTEXT_PATH, // Path to local environment configuration file for offline/local development
      SSM_CONTEXT_PARAM_NAME: SSM_CONTEXT_PARAM_NAME, // The name of the SSM Parameter that holds environment-specific configuration, not including the full path (excludes app name, environment name, stack name)
      IS_OFFLINE: 'true' // remote deployments must explicitly set IS_OFFLINE to 'false' in their context
    };

    // Try to get context from cdk.json file
    try {
      let contextName = app.node.getContext('@context');
      console.debug('Retrieving context for:', contextName);
      contextData = app.node.tryGetContext(contextName);
      context = { ...context, ...contextData }; // Merge retrieved context into default context, with precedence to retrieved context
    } catch (error) {
      throw error;
    }

    const stacks = await createStacks(app, context);

    configureDeploymentOrder(stacks);

  } catch (error) {
    console.error('Error synthesizing stacks:', error);
  }
}

async function createStacks(app, context) {
  try {

    // Admin Identity Stack
    const adminIdentityStack = await createAdminIdentityStack(app, STACK_NAMES.ADMIN_IDENTITY_STACK, context);

    // Public Identity Stack
    const publicIdentityStack = await createPublicIdentityStack(app, STACK_NAMES.PUBLIC_IDENTITY_STACK, context);

    return {
      adminIdentityStack: adminIdentityStack,
      publicIdentityStack: publicIdentityStack
    };

  } catch (error) {
    console.error('Error deploying stacks:', error);
    return;
  }
}

function configureDeploymentOrder(stacks) {
  try {
    // Order the stacks
    stacks?.publicIdentityStack.addDependency(stacks?.adminIdentityStack);
  } catch (error) {
    console.error('Error establishing stack dependencies:', error);
  }
}

buildApp();





