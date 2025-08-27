#!/usr/bin/env node

const cdk = require('aws-cdk-lib');
const { TableManagerStack } = require('../lib/table-manager-stack');

const app = new cdk.App();

// Deploy the TableManager stack
new TableManagerStack(app, 'ReserveRecTableManager', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ca-central-1',
  },
  targetStackName: process.env.STACK_NAME || 'ReserveRecCdkStack'
});

app.synth();
