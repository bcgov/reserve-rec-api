const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { Construct } = require('constructs');

class AdminSearchLambda extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    const api = props?.api;
    const domainArn = props?.opensearchDomainArn;

    if (!api) {
      throw new Error('SearchLambdaConstruct: Missing required property "api" in props');
    }

    this.searchFunction = new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'admin.handler',
      code: lambda.Code.fromAsset('src/handlers/search/POST'),
      layers: props?.layers || [],
      environment: props?.environment || {},
      description: `Handles search requests for the api: ${api?.restApiName}`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    // Create the /search resource
    this.searchResource = api.root.addResource('search');

    // Add POST method to /search resource
    this.searchResource.addMethod('POST', new apigateway.LambdaIntegration(this.searchFunction), {});

    // Add OpenSearch policy to the function
    const openSearchPostPolicy = new iam.PolicyStatement({
      actions: [
        'es:ESHttpPost'
      ],
      resources: [domainArn, `${domainArn}/*`],
    });

    this.searchFunction.addToRolePolicy(openSearchPostPolicy);

  }
}

module.exports = {
  AdminSearchLambda,
};