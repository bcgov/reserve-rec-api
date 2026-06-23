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
    bookingsCompletePOSTFunction: {
      name: 'BookingsCompletePOST',
    },
    bookingsCancelPOSTFunction: {
      name: 'BookingsCancelPOST',
    },
    bookingsSearchPOSTFunction: {
      name: 'bookingsSearchPOST',
    },
    bookingsCheckInPUTFunction: {
      name: 'bookingsCheckInPUT',
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

class AdminBookingsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    // /bookings resource
    this.bookingsResource = this.resolveApi().root.addResource('bookings');

    // /bookings/admin resource
    this.bookingsAdminResource = this.bookingsResource.addResource('admin');

    // /bookings/search resource
    this.bookingsSearchResource = this.bookingsResource.addResource('search');

    // /bookings/{bookingId} and /bookings/{bookingId}/checkin resources
    this.bookingsByBookingIdResource = this.bookingsResource.addResource('{bookingId}');
    this.bookingsByBookingIdCheckinResource = this.bookingsByBookingIdResource.addResource('checkin');
    
    this.addCorsPreflightForResources([
      this.bookingsResource,
      this.bookingsAdminResource,
      this.bookingsSearchResource,
      this.bookingsByBookingIdResource,
      this.bookingsByBookingIdCheckinResource,
    ]);

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

    // GET /bookings/admin (admin search with query param filters)
    this.bookingsAdminResource.addMethod('GET', new apigw.LambdaIntegration(this.bookingsAdminGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

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

    // POST /bookings/search
    this.bookingsSearchResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsSearchFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // PUT /bookings/{bookingId}/checkin Lambda function
    this.bookingsCheckInPutFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsCheckInPUTFunction',
      'src/handlers/bookings/_bookingId/check-in/PUT',
      'admin.handler',
      {
        transDataBasicReadWrite: true,
        basicRead: true,
      }
    );

    this.bookingsCheckInPutFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"], // Consider restricting this to specific user pool ARNs if possible
    }));

    // PUT /bookings/{bookingId}/checkin
    this.bookingsByBookingIdCheckinResource.addMethod('PUT', new apigw.LambdaIntegration(this.bookingsCheckInPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to read functions
    const readFunctions = [
      this.bookingsAdminGetFunction,
    ];

    for (const func of readFunctions) {
      this.grantBasicTransDataTableRead(func);
      this.grantBasicRefDataTableRead(func);
    }

    // Add permissions to write functions
    const writeFunctions = [
      this.bookingsCheckInPutFunction,
    ];

    for (const func of writeFunctions) {
      this.grantBasicTransDataTableReadWrite(func);
      this.grantBasicRefDataTableReadWrite(func);
      this.grantAuditTableWrite(func);
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
  }
}

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
    if (props?.activitiesActivityIdResourceId) {
      // import the /activities/{collectionId}/{activityType}/{activityId} resource from API Gateway using
      // fromResourceAttributes() since it's in a different CDK construct scope
      this.activitiesResource = apigw.Resource.fromResourceAttributes(this, 'ImportedActivitiesActivityIdResource', {
        restApi: this.resolveApi(),
        resourceId: props.activitiesActivityIdResourceId,
        path: '/activities/{collectionId}/{activityType}/{activityId}',
      });
    } else {
      // Local/SAM path: both constructs share the same API object, so getResource() works.
      this.activitiesResource = this.resolveApi().root.getResource('activities')?.getResource('{collectionId}')?.getResource('{activityType}')?.getResource('{activityId}');
    }

    if (!this.activitiesResource) {
      throw new Error('PublicBookingsConstruct: Missing required /activities/{collectionId}/{activityType}/{activityId} resource in API Gateway');
    }
    // Add {startDate}/bookings resource under activities resource
    this.bookingsByActivityResource = this.activitiesResource.addResource('{startDate}').addResource('bookings');

    this.addCorsPreflightForResources([
      this.bookingsResource,
      this.bookingsByBookingIdResource,
      this.bookingsByActivityResource,
    ]);

    // GET /bookings Lambda function
    this.bookingsGetFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsGETFunction',
      'src/handlers/bookings/GET',
      'public.handler',
      {
        transDataBasicRead: true,
        memorySize: 512
      },
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

    // POST /bookings Lambda function
    this.bookingsPostFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsPOSTFunction',
      'src/handlers/bookings/POST',
      'public.handler',
      {
        basicReadWrite: true,
        transDataBasicReadWrite: true,
      }
    );

    // Allow BookingsPOST to make call and find user by sub
    this.bookingsPostFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"],
    }));

    // POST /bookings
    this.bookingsResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /bookings/{bookingId}/complete Lambda function
    this.bookingsCompleteFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsCompletePOSTFunction',
      'src/handlers/bookings/_bookingId/complete/POST',
      'public.handler',
      {
        transDataBasicReadWrite: true,
        basicRead: true,
      }
    );

    // Add permissions for Lambda to read from Cognito User Pools. ListUsers
    // is used by getUserInfoBySub to look up the recipient's verified email
    // by the immutable Cognito sub claim.
    this.bookingsCompleteFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"], // Consider restricting this to specific user pool ARNs if possible
    }));

    // POST /bookings/{bookingId}/cancel Lambda function
    this.bookingsCancelPostFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsCancelPOSTFunction',
      'src/handlers/bookings/_bookingId/cancel/POST',
      'index.handler',
      {
        transDataBasicReadWrite: true,
        basicRead: true,
      }
    );

    // Cancel handler also needs Cognito ListUsers — same getUserInfoBySub path.
    this.bookingsCancelPostFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"], // Consider restricting this to specific user pool ARNs if possible
    }));

    // PUT /bookings/{bookingId}/checkin Lambda function
    this.bookingsCheckInPutFunction = this.generateBasicLambdaFn(
      scope,
      'bookingsCheckInPUTFunction',
      'src/handlers/bookings/_bookingId/check-in/PUT',
      'admin.handler',
      {
        transDataBasicReadWrite: true,
        basicRead: true,
      }
    );

    this.bookingsCheckInPutFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"], // Consider restricting this to specific user pool ARNs if possible
    }));

    // Child action resources under /bookings/{bookingId}
    this.bookingsByBookingIdCompleteResource = this.bookingsByBookingIdResource.addResource('complete');
    this.bookingsByBookingIdCancelResource = this.bookingsByBookingIdResource.addResource('cancel');
    this.bookingsByBookingIdCheckinResource = this.bookingsByBookingIdResource.addResource('checkin');

    this.addCorsPreflightForResources([
      this.bookingsByBookingIdCompleteResource,
      this.bookingsByBookingIdCancelResource,
      this.bookingsByBookingIdCheckinResource,
    ]);

    // POST /bookings/{bookingId}/complete
    this.bookingsByBookingIdCompleteResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsCompleteFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /bookings/{bookingId}/cancel
    this.bookingsByBookingIdCancelResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsCancelPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });
    
    // PUT /bookings/{bookingId}/checkin
    this.bookingsByBookingIdCheckinResource.addMethod('PUT', new apigw.LambdaIntegration(this.bookingsCheckInPutFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // POST /activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings
    this.bookingsByActivityResource.addMethod('POST', new apigw.LambdaIntegration(this.bookingsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add permissions to read functions
    const readFunctions = [
      this.bookingsGetFunction,
    ];

    for (const func of readFunctions) {
      this.grantBasicTransDataTableRead(func);
      this.grantBasicRefDataTableRead(func);
    }

    // Add permissions to write functions
    const writeFunctions = [
      this.bookingsPostFunction,
      this.bookingsCancelPostFunction,
      this.bookingsCheckInPutFunction
    ];

    for (const func of writeFunctions) {
      this.grantBasicTransDataTableReadWrite(func);
      this.grantBasicRefDataTableReadWrite(func);
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
  AdminBookingsConstruct,
  PublicBookingsConstruct,
};
