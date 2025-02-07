/**
 * CDK resources for Tooling.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Duration } = require('aws-cdk-lib');


function toolingSetup(scope, props) {
  console.log('Tooling handlers setup...');

  // Protected Areas sync function, for syncing protected areas from the Data Register
  const syncProtectedAreasFunction = new NodejsFunction(scope, 'SyncProtectedAreasFunction', {
    code: lambda.Code.fromAsset('lib/handlers/tools/protectedAreas/syncFromDataRegister'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    timeout: Duration.minutes(5)
  });

  props.mainTable.grantReadWriteData(syncProtectedAreasFunction);

  // Secrets Manager getSecretValue policystatement, for getting secrets from Secrets Manager
  syncProtectedAreasFunction.addToRolePolicy(new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: ['secretsmanager:GetSecretValue'],
    // TODO: is there a way to restrict to only the secrets you need when the secrets will be stored in different stacks?
    resources: ['arn:aws:secretsmanager:ca-central-1:637423314715:secret:*']
  }));


  // Opensearch createMainIndex function, for initiating the main index
  const createMainIndexFunction = new NodejsFunction(scope, 'CreateMainIndexFunction', {
    code: lambda.Code.fromAsset('lib/handlers/tools/opensearch/createMainIndex'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
    role: props.osRole,
  });

  createMainIndexFunction.addToRolePolicy(new iam.PolicyStatement({
    actions: ['es:ESHttp*'],
    resources: [props.opensearchDomainArn],
  }));

  return {
    syncProtectedAreasFunction: syncProtectedAreasFunction,
    createMainIndexFunction: createMainIndexFunction,
  }
}

module.exports = {
  toolingSetup
};