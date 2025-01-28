/**
 * CDK resources for the config API.
 */
const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

class ConfigResources {
  constructor(scope, id, props) {
    this.scope = scope;
    this.id = id;
    this.props = props;

    const configResource = this.props.api.root.addResource('config');

    // GET /config
    const configGetFunction = new NodejsFunction(this.scope, 'ConfigGet', {
      code: lambda.Code.fromAsset('lib/handlers/config/GET'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: this.props.env,
      layers: this.props.layers,
    });

    configResource.addMethod('GET', new apigateway.LambdaIntegration(configGetFunction));

    // Add DynamoDB query policy to the function
    const dynamoDbPolicy = new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [this.props.mainTable.tableArn],
    });

    configGetFunction.addToRolePolicy(dynamoDbPolicy);

  }
}

module.exports = {
  ConfigResources
};