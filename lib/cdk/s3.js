/**
 * Builds the S3 resources for the Reserve Rec CDK stack.
 */

const s3 = require('aws-cdk-lib/aws-s3');
const { RemovalPolicy } = require('aws-cdk-lib');

function s3Setup(scope, props) {
  console.log('Setting up S3 resources...');

  // S3 BUCKETS

  const geospatialBucket = new s3.Bucket(scope, 'ReserveRecBucket', {
    bucketName: props.env.S3_BUCKET_GEOSPATIAL,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    encryptionKey: props.env.KMS_KEY,
    removalPolicy: RemovalPolicy.DESTROY,
    autoDeleteObjects: true,
    cors: [
      {
        allowedOrigins: ['*'],
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST, s3.HttpMethods.DELETE],
        allowedHeaders: ['*'],
      }
    ],
  });

  return {
    geospatialBucket: geospatialBucket,
  };
}

module.exports = {
  s3Setup,
}