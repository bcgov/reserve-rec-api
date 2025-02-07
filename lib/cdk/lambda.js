/**
 * Builds the Lambda and Layer resources for the Reserve Rec CDK stack.
 */

const { RemovalPolicy } = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');

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
            buildLayerDist(baseLayerEntry, outputDir, props);
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
            buildLayerDist(awsUtilsLayerEntry, outputDir, props);
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
            buildLayerDist(dataUtilsEntry, outputDir, props);
          },
        }
      }
    }),
    compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
    description: 'Data Utils Lambda Layer',
    layerName: 'DataUtilsLayer',
    licenseInfo: 'Apache-2.0',
    removalPolicy: RemovalPolicy.DESTROY, // Will delete the layer when the stack is deleted
  });

  return {
    baseLayer: baseLayer,
    awsUtilsLayer: awsUtilsLayer,
    dataUtilsLayer: dataUtilsLayer,
  };
}


// bundling code reference: https://github.com/aws-samples/cdk-build-bundle-deploy-example/blob/main/cdk-bundle-static-site-example/lib/static-site-stack.ts

function exec(command, options) {
  const proc = spawnSync('bash', ['-c', command], options);

  if (proc.error) {
    throw proc.error;
  }

  if (proc.status != 0) {
    if (proc.stdout || proc.stderr) {
      throw new Error(`[Status ${proc.status}] stdout: ${proc.stdout?.toString().trim()}\n\n\nstderr: ${proc.stderr?.toString().trim()}`);
    }
    throw new Error(`go exited with status ${proc.status}`);
  }

  return proc;
}

function buildLayerDist(entry, outputDir, props) {
  // Check that yarn is installed
  try {
    exec('yarn --version', {
      stdio: [
        'ignore',
        process.stderr,
        'inherit'
      ],
    });
  } catch {
    return false;
  }

  // yarn install node_modules
  try {
    exec(
      [
        'yarn',
      ].join(' && '),
      {
        env: { ...process.env, ...props?.env ?? {} },
        stdio: [
          'ignore',
          process.stderr,
          'inherit'
        ],
        cwd: `${entry}/nodejs` // where to run the build command from
      }
    );

  } catch {
    return false;
  }

  // copy the folder to outputDir
  try {
    fs.copySync(entry, outputDir);
  } catch {
    return false;
  }

  return true;
}



module.exports = {
  layerSetup
};