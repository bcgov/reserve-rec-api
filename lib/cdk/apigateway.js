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
      allowCredentials: true,
      allowOrigins: apigateway.Cors.ALL_ORIGINS,
      allowMethods: apigateway.Cors.ALL_METHODS,
      allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      maxAge: cdk.Duration.seconds(600),
    },
    defaultMethodOptions: {
      authorizer: props.publicRequestAuthorizer,
    },
    deployOptions: {
      stageName: props.env.API_STAGE,
    },
  });

  // API OUTPUT

  new cdk.CfnOutput(scope, 'ReserveRecApiGatewayId', {
    value: api.restApiId,
    description: 'Reserve Rec API Gateway Id Reference',
    exportName: `ReserveRecApiGatewayId-${props.env.ENVIRONMENT}`,
  });

  new cdk.CfnOutput(scope, 'ReserveRecApiRootResourceId', {
    value: api.restApiRootResourceId,
    description: 'Reserve Rec API Root Resource Id Reference',
    exportName: `ReserveRecApiRootResourceId-${props.env.ENVIRONMENT}`,
  });

  new cdk.CfnOutput(scope, `ApiLocation-${props.env.ENVIRONMENT}`, {
    value: `https://${api.restApiId}.execute-api.${scope.region}.amazonaws.com/`,
    description: 'Reserve Rec API URL',
    exportName: `ApiLocation-${props.env.ENVIRONMENT}`,
  });

  new cdk.CfnOutput(scope, `ApiPath-${props.env.ENVIRONMENT}`, {
    value: api.deploymentStage.stageName,
    description: 'Reserve Rec API Stage',
    exportName: `ApiPath-${props.env.ENVIRONMENT}`,
  });

  return {
    api: api,
  };

}

module.exports = {
  apigwSetup
};
