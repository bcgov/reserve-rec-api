/**
 * CDK resources for the OpenSearch search Lambda.
 */

const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function searchSetup(scope, props) {
  console.log('Search handler setup...')

  const searchResource = props.api.root.addResource('search');

  // POST /search
  const searchPostFunction = new NodejsFunction(scope, 'SearchPost', {
    code: lambda.Code.fromAsset('lib/handlers/search/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  searchResource.addMethod(
    "POST",
    new apigateway.LambdaIntegration(searchPostFunction),
    {
      apiKeyRequired: true,
      authorizationType: apigateway.AuthorizationType.NONE,
    }
  );

  // Add OpenSearch policy to the function
  const openSearchGetPolicy = new iam.PolicyStatement({
    actions: [
      'es:ESHttpPost'
    ],
    resources: [props.openSearchDomain.domainArn],
  });

  searchPostFunction.addToRolePolicy(openSearchGetPolicy);

  return {
    searchPostFunction: searchPostFunction,
    searchResource: searchResource
  };
}

module.exports = {
  searchSetup
}
