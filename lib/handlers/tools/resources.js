/**
 * CDK resources for Tooling.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");
const { Duration } = require('aws-cdk-lib');

class ToolingResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    // Protected Areas sync function, for syncing protected areas from the Data Register
    const syncProtectedAreasFunction = new NodejsFunction(this.scope, 'SyncProtectedAreasFunction', {
      code: lambda.Code.fromAsset('lib/handlers/tools/protectedAreas/syncFromDataRegister'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
      timeout: Duration.seconds(30)
    });

    this.props.mainTable.grantReadWriteData(syncProtectedAreasFunction);

    // Secrets Manager getSecretValue policystatement, for getting secrets from Secrets Manager
    syncProtectedAreasFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: ['arn:aws:secretsmanager:ca-central-1:637423314715:secret:*']
    }));


    // Opensearch createMainIndex function, for initiating the main index
    const createMainIndexFunction = new NodejsFunction(this.scope, 'CreateMainIndexFunction', {
      code: lambda.Code.fromAsset('lib/handlers/tools/opensearch/createMainIndex'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
      role: this.props.osRole,
    });

    createMainIndexFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['es:ESHttp*'],
      resources: [this.props.opensearchDomainArn],
    }));

  }
}

module.exports = {
  ToolingResources
};