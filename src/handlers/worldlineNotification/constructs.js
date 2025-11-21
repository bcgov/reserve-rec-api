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
  }
}

module.exports = {
  WorldlineNotificationConstruct,
};
