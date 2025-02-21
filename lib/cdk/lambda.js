/**
 * Builds the Lambda and Layer resources for the Reserve Rec CDK stack.
 */

const { CfnOutput } = require('aws-cdk-lib');
const { RemovalPolicy } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const { buildDist } = require('../tools/bundling/yarnBundler');
const path = require('path');

function layerSetup(scope, props) {
  console.log('Setting up Lambda Layer resources...');

  // LAMBDA LAYERS

  const baseLayerEntry = path.join(__dirname, '../layers/base');
  const baseLayer = new lambda.LayerVersion(scope, 'BaseLambdaLayer', {
    code: lambda.Code.fromAsset(baseLayerEntry, {
      bundling: {
        image: lambda.Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(baseLayerEntry, outputDir, {
              env: props.env,
              nodejsPath: 'nodejs'
            });
          },
        }
      }
    }),
    compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    description: 'Base Utils Lambda Layer',
    layerName: 'BaseUtilsLayer',
    licenseInfo: 'Apache-2.0',
    // TODO: Change RemovalPolicy to RETAIN when we've figured everything out
    removalPolicy: RemovalPolicy.DESTROY, // Will delete the layer when the stack is deleted
  });

  const awsUtilsLayerEntry = path.join(__dirname, '../layers/awsUtils');
  const awsUtilsLayer = new lambda.LayerVersion(scope, 'AwsUtilsLambdaLayer', {
    code: lambda.Code.fromAsset(awsUtilsLayerEntry, {
      bundling: {
        image: lambda.Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(awsUtilsLayerEntry, outputDir, {
              env: props.env,
              nodejsPath: 'nodejs'
            });
          },
        }
      }
    }),
    compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    description: 'AWS Utils Lambda Layer',
    layerName: 'AwsUtilsLayer',
    licenseInfo: 'Apache-2.0',
    removalPolicy: RemovalPolicy.DESTROY, // Will delete the layer when the stack is deleted
  });

  const dataUtilsEntry = path.join(__dirname, '../layers/dataUtils');
  const dataUtilsLayer = new lambda.LayerVersion(scope, 'DataUtilsLambdaLayer', {
    code: lambda.Code.fromAsset(dataUtilsEntry, {
      bundling: {
        image: lambda.Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(dataUtilsEntry, outputDir, {
              env: props.env,
              nodejsPath: 'nodejs'
            });
          }
        }
      }
    }),
    compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    description: 'Data Utils Lambda Layer',
    layerName: 'DataUtilsLayer',
    licenseInfo: 'Apache-2.0',
    removalPolicy: RemovalPolicy.DESTROY, // Will delete the layer when the stack is deleted
  });

  // Outputs
  new CfnOutput(scope, 'BaseLayerArn', {
    value: baseLayer.layerVersionArn,
    description: 'Base Utils Lambda Layer',
    exportName: 'BaseLayerArn',
  });

  new CfnOutput(scope, 'AwsUtilsLayerArn', {
    value: awsUtilsLayer.layerVersionArn,
    description: 'AWS Utils Lambda Layer',
    exportName: 'AwsUtilsLayerArn',
  });

  new CfnOutput(scope, 'DataUtilsLayerArn', {
    value: dataUtilsLayer.layerVersionArn,
    description: 'Data Utils Lambda Layer',
    exportName: 'DataUtilsLayerArn',
  });


  return {
    baseLayer: baseLayer,
    awsUtilsLayer: awsUtilsLayer,
    dataUtilsLayer: dataUtilsLayer,
  };
}



module.exports = {
  layerSetup
};