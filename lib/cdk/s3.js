/**
 * Builds the S3 resources for the Reserve Rec CDK stack.
 */

const { CfnOutput } = require('aws-cdk-lib');
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

  // Outputs
  new CfnOutput(scope, 'ReserveRecBucketName', {
    value: bucketName,
    description: 'Reserve Rec S3 Bucket Name',
    exportName: `ReserveRecBucketGeospatial-${props.env.ENVIRONMENT}`,
  });

  return {
    geospatialBucket: geospatialBucket,
  };
}

module.exports = {
  s3Setup,
}
