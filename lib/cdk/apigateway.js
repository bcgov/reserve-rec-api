/**
 * Builds the API Gateway resources for the Reserve Rec CDK stack.
 */

const apigateway = require('aws-cdk-lib/aws-apigateway');
const cdk = require('aws-cdk-lib');

function apigwSetup(scope, props) {
  console.log('Setting up API Gateway resources...');

  // API GATEWAY

  const api = new apigateway.RestApi(scope, 'ApiDeployment', {
    restApiName: 'ReserveRecApi',
    description: 'Reserve Rec API',
    deploy: true, // redeploy if methods/resources change
    defaultCorsPreflightOptions: {
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
    },
  });

  // API STAGE DEPLOYMENT

  const deployment = new apigateway.Deployment(scope, 'ApiDeploymentConstruct', { api });

  const stage = new apigateway.Stage(scope, `ApiStage-${props.env.API_STAGE}`, {
    deployment,
    stageName: props.env.API_STAGE
  });

  api.deploymentStage = stage;

  // API OUTPUT

  new cdk.CfnOutput(scope, 'ReserveRecApiGatewayId', {
    value: api.restApiId,
    description: 'Reserve Rec API Gateway Id Reference',
    exportName: 'ReserveRecApiGatewayId',
  });

  return {
    api: api,
    deployment: deployment,
    stage: stage,
  };

}

module.exports = {
  apigwSetup
};