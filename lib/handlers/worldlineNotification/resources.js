const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function worldlineNotificationSetup(scope, props) {
  console.log("Worldline Notification handlers setup...");

  // /worldline-notification resource
  const worldlineNotificationResource = props.api.root.addResource(
    "worldline-notification"
  );

  // POST /worldline-notification
  const worldlineNotificationPost = new NodejsFunction(scope, "WorldlineNotificationPost", {
      code: lambda.Code.fromAsset("lib/handlers/worldlineNotification/POST"),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      environment: props.env,
      layers: props.layers,
    }
  );

  worldlineNotificationResource.addMethod("POST", new apigateway.LambdaIntegration(worldlineNotificationPost),{
    authorizationType: apigateway.AuthorizationType.NONE
  });

  const dynamodbPolicy = new iam.PolicyStatement({
    actions: [
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
    ],
    resources: [
      props.mainTable.tableArn,
      `${props.mainTable.tableArn}/index/*`,
    ],
  });
  worldlineNotificationPost.addToRolePolicy(dynamodbPolicy);

  return {
    worldlineNotificationResource: worldlineNotificationResource,
    worldlineNotificationPost: worldlineNotificationPost,
  };
}

module.exports = {
  worldlineNotificationSetup,
};
