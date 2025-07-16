/**
 * CDK resources for the bookings API.
 *
 * Note: Pursuant of completing an E2E proof of concept, a planned step has been skipped:
 *
 * Bookings generally were planned to be made against a specific Product datatype, such that policies and date
 * restrictions could be applied. For the E2E, only backcountry registration offerings are being considered, which
 * are unlimited in quanity and typically offered year-round. Because of this, it is assumed that no verification of
 * the Product type is required, and therefore bookings can be made against the Activity datatype.
 *
 * This assumtion is not a requirement of the system, but rather a design decision made to simplify the E2E proof of
 * concept. It will need to be revised in the future to handle the more complex case of verifying the bookings.
 */

const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function bookingsSetup(scope, props) {
  console.log('Bookings handlers setup...');

  // /bookings resource
  const bookingsResource = props.api.root.addResource('bookings');

  // /bookings/{bookingId} resource (specific booking)
  const bookingsByBookingIdResource = bookingsResource.addResource('{bookingId}');

  // /bookings by activity resource (extends from /activities/{acCollectionId}/{activityType}/{activityId}/{startDate}/bookings)
  const bookingsByActivityResource = props.activitiesResources.activitiesCollectionIdResource
    .addResource('{activityType}')
    .addResource('{activityId}')
    .addResource('{startDate}')
    .addResource('bookings');

  // GET /bookings
  const bookingsGet = new NodejsFunction(scope, 'BookingsGet', {
    code: lambda.Code.fromAsset('lib/handlers/bookings/GET'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  bookingsResource.addMethod('GET', new apigateway.LambdaIntegration(bookingsGet));
  bookingsByBookingIdResource.addMethod('GET', new apigateway.LambdaIntegration(bookingsGet));
  bookingsByActivityResource.addMethod('GET', new apigateway.LambdaIntegration(bookingsGet));

  // POST /bookings
  const bookingsPost = new NodejsFunction(scope, 'BookingsPost', {
    code: lambda.Code.fromAsset('lib/handlers/bookings/POST'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  bookingsResource.addMethod('POST', new apigateway.LambdaIntegration(bookingsPost));
  bookingsByActivityResource.addMethod('POST', new apigateway.LambdaIntegration(bookingsPost));
 
  // PUT /bookings
  const bookingsPut = new NodejsFunction(scope, 'BookingsPut', {
    code: lambda.Code.fromAsset('lib/handlers/bookings/PUT'),
    handler: 'index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  bookingsResource.addMethod('PUT', new apigateway.LambdaIntegration(bookingsPut));
  bookingsByActivityResource.addMethod('PUT', new apigateway.LambdaIntegration(bookingsPut));

  const dynamodbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:BatchWriteItem',
      'dynamodb:PutItem',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'dynamodb:UpdateItem',
    ],
    resources: [props.mainTable.tableArn, `${props.mainTable.tableArn}/index/*`],
  });
  bookingsGet.addToRolePolicy(dynamodbPolicy);
  bookingsPost.addToRolePolicy(dynamodbPolicy);
  bookingsPut.addToRolePolicy(dynamodbPolicy);

  return {
    bookingsResource: bookingsResource,
    bookingsByBookingIdResource: bookingsByBookingIdResource,
    bookingsByActivityResource: bookingsByActivityResource,
    bookingsGet: bookingsGet,
    bookingsPost: bookingsPost,
    bookingsPut: bookingsPut,
  };

}

module.exports = {
  bookingsSetup,
};
