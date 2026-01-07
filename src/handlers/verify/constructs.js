const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    verifyGETFunction: {
      name: 'VerifyGET',
    }
  },
};

class VerifyConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // /verify resource
    this.verifyResource = this.resolveApi().root.addResource('verify');

    // /verify/{bookingId} resource
    this.verifyBookingIdResource = this.verifyResource.addResource('{bookingId}');

    // /verify/{bookingId}/{hash} resource
    this.verifyHashResource = this.verifyBookingIdResource.addResource('{hash}');

    // GET /verify/{bookingId}/{hash} Lambda function
    this.verifyGetFunction = this.generateBasicLambdaFn(
      scope,
      'verifyGETFunction',
      'src/handlers/verify/GET',
      'admin.handler',
      {
        transDataBasicRead: true,
      }
    );

    // GET /verify/{bookingId}/{hash} (admin-only endpoint)
    this.verifyHashResource.addMethod('GET', new apigw.LambdaIntegration(this.verifyGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to read from transactional data table
    this.grantBasicTransDataTableRead(this.verifyGetFunction);
    
    // Add permissions to read from reference data table (for access points)
    this.grantBasicRefDataTableRead(this.verifyGetFunction);
  }
}

module.exports = {
  VerifyConstruct,
};
