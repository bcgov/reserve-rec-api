const { Construct } = require('constructs');
const lambda = require('aws-cdk-lib/aws-lambda');
const { RemovalPolicy } = require('aws-cdk-lib');
const path = require('path');
const { buildDist } = require('../tools/bundling/yarnBundler');

const LAMBDA_BASE_LAYER_PATH = './base';
const NODEJS_PATH = 'nodejs';

function createBaseLayer(scope, id, props) {
  const constants = props?.CONSTANTS;

  const baseLayerEntry = path.join(__dirname, LAMBDA_BASE_LAYER_PATH);
  const layer = new lambda.LayerVersion(scope, id, {
    layerName: id,
    code: lambda.Code.fromAsset(baseLayerEntry, {
      bundling: {
        image: lambda.Runtime.NODEJS_20_X.bundlingImage,
        command: [],
        local: {
          tryBundle(outputDir) {
            buildDist(baseLayerEntry, outputDir, {
              env: props?.ENVIRONMENT_NAME,
              nodejsPath: NODEJS_PATH,
            }
            );
          }
        }
      }
    }),
    compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    description: `Base layer for Lambda functions in ${constants?.APP_NAME} - ${props?.ENVIRONMENT_NAME} environment`,
    removalPolicy: RemovalPolicy.DESTROY,
    license: 'Apache-2.0',
  });
  return layer;
}

module.exports = {
  createBaseLayer,
};