const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");

const defaults = {
  resources: {
    bookingsGETFunction: {
      name: 'BookingsGET',
    },
    bookingsPOSTFunction: {
      name: 'BookingsPOST',
    },
    bookingsCancelPOSTFunction: {
      name: 'BookingsCancelPOST',
    },
    bookingsSearchPOSTFunction: {
      name: 'bookingsSearchPOST',
    },
    bookingsPUTFunction: {
      name: 'BookingsPUT',
    },
    bookingsDELETEFunction: {
      name: 'BookingsDELETE',
    },
    bookingsAdminGETFunction: {
      name: 'BookingsAdminGET',
    }
  },
};

class PublicBookingsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // /bookings resource
    this.bookingsResource = this.resolveApi().root.addResource('bookings');

    // /bookings/{bookingId} resource (specific booking)
    this.bookingsByBookingIdResource = this.bookingsResource.addResource('{bookingId}');

    // /bookings by activity resource (extends from /activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings)
    // Get reference to activities resource from props
    this.activitiesResource = this.resolveApi().root.getResource('activities')?.getResource('{collectionId}')?.getResource('{activityType}')?.getResource('{activityId}');

    if (!this.activitiesResource) {
      throw new Error('PublicBookingsConstruct: Missing required /activities/{collectionId}/{activityType}/{activityId} resource in API Gateway');
    }
    // Add {startDate}/bookings resource under activities resource
    this.bookingsByActivityResource = this.activitiesResource.addResource('{startDate}').addResource('bookings');

    // /bookings/admin resource
    this.bookingsAdminResource = this.bookingsResource.addResource('admin');

    // /bookings/search resource
    this.bookingsSearchResource = this.bookingsResource.addResource('search');

    // GET /bookings Lambda function
    this.bookingsGetFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsGETFunction',
      'src/handlers/bookings/GET',
      'public.handler',
      {
        transDataBasicRead: true,
      }
    );

    // GET /bookings/admin Lambda function
    this.bookingsAdminGetFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsAdminGETFunction',
      'src/handlers/bookings/GET',
      'admin.handler',
      {
        transDataBasicRead: true,
      }
    );

    // GET /bookings
    this.bookingsResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /bookings/{bookingId}
    this.bookingsByBookingIdResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings
    this.bookingsByActivityResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /bookings/admin (admin search with query param filters)
    this.bookingsAdminResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsAdminGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /bookings Lambda function
    this.bookingsPostFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsPOSTFunction',
      'src/handlers/bookings/POST',
      'public.handler',
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /bookings/search Lambda function
    this.bookingsSearchFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsSearchPOSTFunction',
      'src/handlers/bookings/search/POST',
      'index.handler',
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /bookings
    this.bookingsResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /bookings/{bookingId}/cancel Lambda function
    this.bookingsCancelPostFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsCancelPOSTFunction',
      'src/handlers/bookings/cancel/POST',
      'index.handler',
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /bookings/{bookingId}/cancel
    this.bookingsByBookingIdResource.addResource('cancel').addMethod('POST', new apigw.LambdaIntegration(this.bookingsCancelPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings
    this.bookingsByActivityResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /bookings/search
    this.bookingsSearchResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsSearchFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to read functions
    const readFunctions = [
      this.bookingsGetFunction,
      this.bookingsAdminGetFunction,
    ];

    for (const func of readFunctions) {
      this.grantBasicTransDataTableRead(func);
    }

    // Add permissions to write functions
    const writeFunctions = [
      this.bookingsPostFunction,
      this.bookingsCancelPostFunction,
    ];

    for (const func of writeFunctions) {
      this.grantBasicTransDataTableReadWrite(func);
    }

    // Grant OpenSearch permissions to search function
    if (props?.openSearchDomainArn) {
      this.bookingsSearchFunction.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'es:ESHttpGet',
          'es:ESHttpPost',
        ],
        resources: [`${props.openSearchDomainArn}/*`],
      }));
    }

    // Grant SNS publish permissions to the cancel function
    const topicArn = this.resolveEnvironment()?.BOOKING_NOTIFICATION_TOPIC_ARN;
    if (topicArn) {
      this.bookingsCancelPostFunction.addToRolePolicy(new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [topicArn],
      }));
    }

    // Grant KMS permissions if KMS key is provided
    if (props?.kmsKey) {
      this.bookingsCancelPostFunction.addToRolePolicy(new iam.PolicyStatement({
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey',
        ],
        resources: [props.kmsKey.keyArn],
      }));
    }
  }
}

module.exports = {
  PublicBookingsConstruct,
};
