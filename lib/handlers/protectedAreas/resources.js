/**
 * CDK resources for the protected areas API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const { CfnOutput } = require('aws-cdk-lib');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class ProtectedAreaResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    const protectedAreasResource = this.props.api.root.addResource('protected-areas');

    // GET /protected-areas
    const protectedAreasGetFunction = new NodejsFunction(this.scope, 'ProtectedAreasGet', {
      code: lambda.Code.fromAsset('lib/handlers/protectedAreas/GET'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
    });

    protectedAreasResource.addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetFunction));

    // GET /protected-areas/orcs
    const protectedAreasGetByOrcsFunction = new NodejsFunction(this.scope, 'ProtectedAreasGetByOrcs', {
      code: lambda.Code.fromAsset('lib/handlers/protectedAreas/_orcs/GET'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
    });

    protectedAreasResource.addResource('{orcs}').addMethod('GET', new apigateway.LambdaIntegration(protectedAreasGetByOrcsFunction));
  }
}

module.exports = {
  ProtectedAreaResources
};