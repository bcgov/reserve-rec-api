const lambda = require('aws-cdk-lib/aws-lambda');
const { RemovalPolicy } = require('aws-cdk-lib');
const { Construct } = require('constructs');
const path = require('path');
const { buildDist } = require('../scripts/tools/bundling/yarnBundler');

const LAMBDA_BASE_LAYER_PATH = './base';
const LAMBDA_AWS_LAYER_PATH = './awsUtils';
const NODEJS_PATH = 'nodejs';

class BaseLayerConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);

    super(scope, constructId, props);

    this.baseLayerEntry = path.join(__dirname, LAMBDA_BASE_LAYER_PATH);
    const baseLayerPath = this.baseLayerEntry;
    this.layer = new lambda.LayerVersion(scope, id, {
      layerName: id,
      code: lambda.Code.fromAsset(this.baseLayerEntry, {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir) {
              buildDist(baseLayerPath, outputDir, {
                env: props?.environment,
                nodejsPath: NODEJS_PATH,
              }
              );
            }
          }
        }
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: `Base layer for Lambda functions in ${scope.getAppName()} - ${scope.getDeploymentName()} environment`,
      removalPolicy: RemovalPolicy.DESTROY,
      license: 'Apache-2.0',
    });

  }

  getLayer() {
    return this.layer;
  }
}

class AwsUtilsLayerConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    this.awsUtilsLayerEntry = path.join(__dirname, LAMBDA_AWS_LAYER_PATH);
    const awsUtilsLayerPath = this.awsUtilsLayerEntry;
    this.layer = new lambda.LayerVersion(scope, id, {
      layerName: id,
      code: lambda.Code.fromAsset(this.awsUtilsLayerEntry, {
        bundling: {
          image: lambda.Runtime.NODEJS_20_X.bundlingImage,
          command: [],
          local: {
            tryBundle(outputDir) {
              buildDist(awsUtilsLayerPath, outputDir, {
                env: props?.environment,
                nodejsPath: NODEJS_PATH,
              }
              );
            }
          }
        }
      }),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: `AWS Utils layer for Lambda functions in ${scope.getAppName()} - ${scope.getDeploymentName()} environment`,
      removalPolicy: RemovalPolicy.DESTROY,
      license: 'Apache-2.0',
    });

  }
  getLayer() {
    return this.layer;
  }
}

module.exports = {
  BaseLayerConstruct,
  AwsUtilsLayerConstruct,
};