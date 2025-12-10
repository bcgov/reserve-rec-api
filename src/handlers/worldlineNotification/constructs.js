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
      this.worldlineNotificationPostFunction.addEnvironment('AWS_REGION', process.env.AWS_REGION || 'ca-central-1');
    }

    // POST /worldlineNotification
    this.worldlineNotificationResource.addMethod('POST', new apigw.LambdaIntegration(this.worldlineNotificationPostFunction), {
      authorizationType: apigw.AuthorizationType.NONE,
    });

    // Add permissions to all functions
    const functions = [
      this.worldlineNotificationPostFunction,
    ];

    for (const func of functions) {
      this.grantBasicTransDataTableReadWrite(func);
    }

    // Grant SQS send message permissions if email queue is available
    if (emailQueueArn) {
      this.worldlineNotificationPostFunction.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
        resources: [emailQueueArn],
      }));
    }
  }
}

module.exports = {
  WorldlineNotificationConstruct,
};
