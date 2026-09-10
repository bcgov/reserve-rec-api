const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { logger } = require('../helpers/utils');

const defaults = {
  description: 'Public Identity Integration stack. Its resources moved into the Public Identity stack; this deploys empty so CloudFormation removes them, and is then deleted.',
  constructs: {},
  config: {
    logLevel: process.env.LOG_LEVEL || 'info',
  },
};

async function createPublicIdentityIntegrationStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new PublicIdentityIntegrationStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Public Identity Integration Stack: ${error}`);
  }
}

/**
 * Deliberately empty.
 *
 * This stack used to hold the Cognito trigger Lambdas and attach them to the
 * pool with UpdateUserPool. That made two stacks writers of one pool, and the
 * identity stack — which owns the AWS::Cognito::UserPool resource — sends its
 * own view of the pool on every property change, dropping whatever was attached
 * from here. The triggers now live beside the pool.
 *
 * Deploying this empty removes the old Lambdas, the provider and the custom
 * resource (whose Delete is a no-op by design, so it does not touch the pool).
 * Once that has happened in every environment, remove the stack from bin/app.js
 * and delete it.
 */
class PublicIdentityIntegrationStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);
    logger.info(`Creating Public Identity Integration Stack (empty, pending removal): ${this.stackId}`);
  }
}

module.exports = {
  createPublicIdentityIntegrationStack,
};
