#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const { createCoreStack } = require('../lib/core-stack/core-stack');
const { createAdminIdentityStack } = require('../lib/admin-identity-stack/admin-identity-stack');
const { createPublicIdentityStack } = require('../lib/public-identity-stack/public-identity-stack');
const { createAdminApiStack } = require('../lib/admin-api-stack/admin-api-stack');
const { CONSTANTS } = require('../lib/constants.js');

// Main function to build the CDK app
async function buildApp() {
  console.log('Starting CDK application synthesis...');

  try {
    // Create the CDK application
    const app = new cdk.App();

    // Initialize context objects
    let context = {
      CONSTANTS: CONSTANTS
    };

    // Try to get context from cdk.json file
    try {
      let contextName = app.node.getContext('@context');
      console.debug('Retrieving context for:', contextName);
      context = { ...context, ...app.node.tryGetContext(contextName) };
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

    let appConstants = context?.CONSTANTS;

    // Core Stack
    const coreStack = await createCoreStack(app, appConstants?.STACKS?.CORE_STACK?.STACK_NAME, context);

    // Admin Identity Stack
    const adminIdentityStack = await createAdminIdentityStack(app, appConstants?.STACKS?.ADMIN_IDENTITY_STACK?.STACK_NAME, context);

    // Public Identity Stack
    const publicIdentityStack = await createPublicIdentityStack(app, appConstants?.STACKS?.PUBLIC_IDENTITY_STACK?.STACK_NAME, context);

    // Admin API Stack
    const adminApiStack = await createAdminApiStack(app, appConstants?.STACKS?.ADMIN_API_STACK?.STACK_NAME, context);

    return {
      coreStack: coreStack,
      adminIdentityStack: adminIdentityStack,
      publicIdentityStack: publicIdentityStack,
      adminApiStack: adminApiStack,
    };

  } catch (error) {
    console.error('Error deploying stacks:', error);
    return;
  }
}

function configureDeploymentOrder(stacks) {
  try {
    // Order the stacks
    stacks?.adminIdentityStack.addDependency(stacks?.coreStack);
    stacks?.publicIdentityStack.addDependency(stacks?.coreStack);
    stacks?.adminApiStack.addDependency(stacks?.coreStack);
    stacks?.adminApiStack.addDependency(stacks?.adminIdentityStack);
  } catch (error) {
    console.error('Error establishing stack dependencies:', error);
  }
}

buildApp();





