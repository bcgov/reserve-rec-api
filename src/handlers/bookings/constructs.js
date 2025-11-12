const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");

const defaults = {
  resources: {
    bookingsGETFunction: {
      name: 'BookingsGET',
    },
    bookingsPOSTFunction: {
      name: 'BookingsPOST',
    },
    bookingsPUTFunction: {
      name: 'BookingsPUT',
    },
    bookingsDELETEFunction: {
      name: 'BookingsDELETE',
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

    // SEARCH /bookings/search (for admin use)
    this.bookingsSearchResource = this.bookingsResource.addResource('search');

    // GET /bookings Lambda function
    this.bookingsGetFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsGETFunction',
      'src/handlers/bookings/GET',
      'public.handler',
      {
        basicReadWrite: true,
      }
    );

    // // GET /bookings
    // this.bookingsResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsGetFunction), {
    //   authorizationType: apigw.AuthorizationType.CUSTOM,
    //   authorizer: this.resolveAuthorizer(),
    // });

    // // GET /bookings/{bookingId}
    // this.bookingsByBookingIdResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsGetFunction), {
    //   authorizationType: apigw.AuthorizationType.CUSTOM,
    //   authorizer: this.resolveAuthorizer(),
    // });

    // // GET /activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings
    // this.bookingsByActivityResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsGetFunction), {
    //   authorizationType: apigw.AuthorizationType.CUSTOM,
    //   authorizer: this.resolveAuthorizer(),
    // });

    // // POST /bookings Lambda function
    // this.bookingsPostFunction = this.generateBasicLambdaFn(
    //   scope,
    //   'bookingsPOSTFunction',
    //   'src/handlers/bookings/POST',
    //   'public.handler',
    //   {
    //     basicReadWrite: true,
    //   }
    // );

    // // POST /bookings
    // this.bookingsResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsPostFunction), {
    //   authorizationType: apigw.AuthorizationType.CUSTOM,
    //   authorizer: this.resolveAuthorizer(),
    // });

    // // POST /activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings
    // this.bookingsByActivityResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsPostFunction), {
    //   authorizationType: apigw.AuthorizationType.CUSTOM,
    //   authorizer: this.resolveAuthorizer(),
    // });

  }
}

module.exports = {
  PublicBookingsConstruct,
};