/**
 * Builds the API Gateway resources for the Reserve Rec CDK stack.
 */

const apigateway = require('aws-cdk-lib/aws-apigateway');
const cdk = require('aws-cdk-lib');

function apigwSetup(scope, props) {
  console.log('Setting up API Gateway resources...');

  // TOKEN AUTHORIZER

  const requestAuthorizer = new apigateway.RequestAuthorizer(scope, 'RequestAuthorizer', {
    handler: props.authFunction,
    identitySources: [apigateway.IdentitySource.header('Authorization')],
    authorizerName: 'ReserveRecAuthorizer',
  });

  // API GATEWAY

  const api = new apigateway.RestApi(scope, 'ApiDeployment', {
    restApiName: 'ReserveRecApi',
    description: 'Reserve Rec API',
    deploy: true, // redeploy if methods/resources change
    defaultCorsPreflightOptions: {
      allowCredentials: true,
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      maxAge: cdk.Duration.seconds(600),
    },
    defaultMethodOptions: {
      authorizer: requestAuthorizer,
    }
  });

  // API STAGE DEPLOYMENT

  const deployment = new apigateway.Deployment(scope, 'ApiDeploymentConstruct', { api });

  const stage = new apigateway.Stage(scope, `ApiStage-${props.env.API_STAGE}`, {
    deployment: deployment,
    stageName: props.env.API_STAGE
  });

  api.deploymentStage = stage;

  // API OUTPUT

  new cdk.CfnOutput(scope, 'ReserveRecApiGatewayId', {
    value: api.restApiId,
    description: 'Reserve Rec API Gateway Id Reference',
    exportName: 'ReserveRecApiGatewayId',
  });

  new cdk.CfnOutput(scope, 'ReserveRecApiDeploymentId', {
    value: deployment.deploymentId,
    description: 'Reserve Rec API Deployment Id Reference',
    exportName: 'ReserveRecApiDeploymentId',
  });

  new cdk.CfnOutput(scope, 'ReserveRecApiRootResourceId', {
    value: api.restApiRootResourceId,
    description: 'Reserve Rec API Root Resource Id Reference',
    exportName: 'ReserveRecApiRootResourceId',
  });

  new cdk.CfnOutput(scope, 'ApiLocation', {
    value: `https://${api.restApiId}.execute-api.${scope.region}.amazonaws.com/`,
    description: 'Reserve Rec API URL',
    exportName: 'ApiLocation',
  });

  new cdk.CfnOutput(scope, 'ApiPath', {
    value: stage.stageName,
    description: 'Reserve Rec API Stage',
    exportName: 'ApiPath',
  });

  return {
    api: api,
    deployment: deployment,
    stage: stage
  };

}

module.exports = {
  apigwSetup
};