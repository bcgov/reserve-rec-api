/**
 * CDK resources for Tooling.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class ToolingResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    // Opensearch createMainIndex function, for initiating the main index
    const createMainIndexFunction = new NodejsFunction(this.scope, 'CreateMainIndexFunction', {
      code: lambda.Code.fromAsset('lib/handlers/tools/opensearch/createMainIndex'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
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