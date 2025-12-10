const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");

const defaults = {
  resources: {
    worldlineNotificationPostFunction: {
      name: 'WorldlineNotificationPOST',
    }
  }
};

class WorldlineNotificationConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'index';
    const handlerName = `${handlerPrefix}.handler`;

    // Get email queue URL and ARN from props
    const emailQueueUrl = props?.emailQueueUrl;
    const emailQueueArn = props?.emailQueueArn;

    // Add /worldlineNotification resource
    this.worldlineNotificationResource = this.resolveApi().root.addResource('worldline-notification');

    // worldlineNotification POST Lambda Function
    this.worldlineNotificationPostFunction = this.generateBasicLambdaFn(
      scope,
      'worldlineNotificationPostFunction',
      'src/handlers/worldlineNotification/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // Add EMAIL_QUEUE_URL environment variable
    if (emailQueueUrl) {
      this.worldlineNotificationPostFunction.addEnvironment('EMAIL_QUEUE_URL', emailQueueUrl);
      // Note: AWS_REGION is automatically available in Lambda environment and cannot be set manually
    }
    
    // Grant SQS send message permissions BEFORE adding API method
    // Note: Must be done before method creation to ensure permissions are in place
    if (emailQueueArn) {
      this.worldlineNotificationPostFunction.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        resources: [emailQueueArn],
      }));
    }

    // POST /worldline-notification
    // Force recreation of method to fix CloudFormation drift by changing logical ID
    const postMethod = this.worldlineNotificationResource.addMethod('POST', new apigw.LambdaIntegration(this.worldlineNotificationPostFunction), {
      authorizationType: apigw.AuthorizationType.NONE,
      methodResponses: [
        {
          statusCode: '200',
        },
        {
          statusCode: '400',
        },
        {
          statusCode: '500',
        }
      ],
    });
    
    // Override logical ID to force CloudFormation to treat this as a new resource
    const cfnMethod = postMethod.node.defaultChild;
    cfnMethod.overrideLogicalId('PublicApiworldlinenotificationPOSTv2');

    // Add permissions to all functions
    const functions = [
      this.worldlineNotificationPostFunction,
    ];

    for (const func of functions) {
      this.grantBasicTransDataTableReadWrite(func);
    }
  }
}

module.exports = {
  WorldlineNotificationConstruct,
};
