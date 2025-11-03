const lambda = require('aws-cdk-lib/aws-lambda');
const { Duration } = require('aws-cdk-lib');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { LambdaConstruct } = require('../../../lib/helpers/base-lambda');

class AdminSearchLambda extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, props);

    const api = this.resolveApi();
    const domainArn = props?.opensearchDomainArn;

    if (!api) {
      throw new Error('SearchLambdaConstruct: Missing required property "api" in props');
    }

    this.searchFunction = new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'admin.handler',
      code: lambda.Code.fromAsset('src/handlers/search/POST'),
      layers: this.resolveLayers(),
      environment: this.resolveEnvironment(),
      description: `Handles search requests for the api: ${api?.restApiName}`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    // Create the /search resource
    this.searchResource = api.root.addResource('search');

    // Add POST method to /search resource
    this.searchResource.addMethod('POST', new apigateway.LambdaIntegration(this.searchFunction), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

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

// TODO: This class is  currently uses the admin handler. Create a separate public handler if needed.
class PublicSearchLambda extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, props);

    const api = this.resolveApi();
    const domainArn = props?.opensearchDomainArn;

    if (!api) {
      throw new Error('SearchLambdaConstruct: Missing required property "api" in props');
    }

    this.searchFunction = new lambda.Function(scope, id, {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'admin.handler',
      code: lambda.Code.fromAsset('src/handlers/search/POST'),
      layers: this.resolveLayers(),
      environment: this.resolveEnvironment(),
      description: `Handles search requests for the api: ${api?.restApiName}`,
      functionName: id,
      timeout: Duration.seconds(10),
    });

    // Create the /search resource
    this.searchResource = api.root.addResource('search');

    // Add POST method to /search resource
    this.searchResource.addMethod('POST', new apigateway.LambdaIntegration(this.searchFunction), {
      authorizationType: apigateway.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

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
  PublicSearchLambda,
};