/**
 * CDK resources for OpenSearch/search function.
 */

const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class SearchFunctionResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    const searchFunctionResource = this.props.api.root.addResource('search');

    // Search
    const searchFunction = new NodejsFunction(this.scope, 'SearchFunction', {
      code: lambda.Code.fromAsset('lib/handlers/search'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
    });

    searchFunctionResource.addMethod('POST', new apigateway.LambdaIntegration(searchFunction));

    // Add OpenSearch policy to the function
    const openSearchPolicy = new iam.PolicyStatement({
      actions: ['es:ESHttpPost'],
      resources: [this.props.openSearchDomain.domainArn],
    });

    searchFunction.addToRolePolicy(openSearchPolicy);
  }
}

module.exports = {
  SearchFunctionResources
};