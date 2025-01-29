
const { Aws, Stack, RemovalPolicy } = require('aws-cdk-lib');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const apigatewayv2 = require('aws-cdk-lib/aws-apigatewayv2');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const lambda = require('aws-cdk-lib/aws-lambda');
const iam = require('aws-cdk-lib/aws-iam');
const opensearch = require('aws-cdk-lib/aws-opensearchservice');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs-extra');

// PROJECT RESOURCES
const { ConfigResources } = require('./handlers/config/resources');
const { ProtectedAreaResources } = require('./handlers/protectedAreas/resources');
const { WebSocketResources } = require('./handlers/webSockets/resources');

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

class ReserveRecCdkStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // API GATEWAY

    const api = new apigateway.RestApi(this, 'ApiDeployment', {
      restApiName: 'ReserveRecApi',
      description: 'Reserve Rec API',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // API STAGE DEPLOYMENT

    const deployment = new apigateway.Deployment(this, 'ApiDeploymentConstruct', { api });

    const stage = new apigateway.Stage(this, `ApiStage-${props.env.API_STAGE}`, {
      deployment,
      stageName: props.env.API_STAGE
    });

    api.deploymentStage = stage;

    // WEB SOCKET API

    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi');
    new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi,
      stageName: 'dev',
      autoDeploy: true,
    });

    // DYNAMODB TABLES

    // Main Reserve Rec Data Table
    const mainTable = new dynamodb.Table(this, 'MainTable', {
      tableName: props.env.TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // Audit Table
    const auditTable = new dynamodb.Table(this, 'AuditTable', {
      tableName: props.env.AUDIT_TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });

    // PubSub Table
    const pubsubTable = new dynamodb.Table(this, 'PubSubTable', {
      tableName: props.env.PUBSUB_TABLE_NAME,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      pointInTimeRecovery: true,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
    });



    // OPENSEARCH

    const osAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['es:*'],
      resources: [`arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${props.env.OPENSEARCH_DOMAIN_NAME}`],
    });

    const opensearchDomain = new opensearch.Domain(this, 'OpenSearchDomain', {
      domainName: props.env.OPENSEARCH_DOMAIN_NAME,
      accessPolicies: [osAccessPolicy],
      capacity: {
        dataNodes: 2,
        multiAzWithStandbyEnabled: false,
      },
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
        kmsKey: props.env.KMS_KEY_ID,
      },
      version: opensearch.EngineVersion.openSearch('2.17'),
      enableVersionUpgrade: true,
      ebs: {
        enabled: true,
        volumeSize: 10,
        throughput: 125,
        volumeType: 'gp3',
        iops: parseInt(props.env.EBS_IOPS),
      },
      advancedSecurityOptions: {
        enabled: true,
        internalUserDatabaseEnabled: false,
      },
      zoneAwareness: {
        enabled: false,
      },
      // TODO: Change RemovalPolicy to RETAIN when we've figured everything out
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // DYNAMODB STREAMS

    // StreamRole

    const streamRoleDynamoDBPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:DeleteItem',
        'dynamodb:PutItem',
        'dynamodb:Scan',
        'dynamodb:Query',
        'dynamodb:UpdateItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:BatchGetItem',
        'dynamodb:DescribeTable',
        'dynamodb:ConditionCheckItem',
      ],
      resources: [auditTable.tableArn],
    });

    const streamRoleOSPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:ESHttpPost',
        'es:ESHttpPut',
      ],
      resources: [`arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${Aws.STACK_NAME}-os`],
    });

    // const streamRole = new iam.Role(this, 'StreamRole', {
    //   accessPolicies: [
    //     streamRoleDynamoDBPolicy,
    //     streamRoleOSPolicy,
    //   ]
    // });

    // Add streamrole as opensearch master arn
    // opensearchDomain.advancedSecurityOptions.masterUserArn = streamRole.roleArn;

    // LAMBDA LAYERS

    const baseLayerEntry = path.join(__dirname, 'layers/base');
    const baseLayer = new lambda.LayerVersion(this, 'BaseLambdaLayer', {
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

    const awsUtilsLayerEntry = path.join(__dirname, 'layers/awsUtils');
    const awsUtilsLayer = new lambda.LayerVersion(this, 'AwsUtilsLambdaLayer', {
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

    const dataUtilsEntry = path.join(__dirname, 'layers/dataUtils');
    const dataUtilsLayer = new lambda.LayerVersion(this, 'DataUtilsLambdaLayer', {
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

    const configResources = new ConfigResources(this, 'ConfigResources', {
      env: props.env,
      api: api,
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      mainTable: mainTable
    });

    const protectedAreaResources = new ProtectedAreaResources(this, 'ProtectedAreaResources', {
      env: props.env,
      api: api,
      layers: [
        baseLayer,
        awsUtilsLayer,
        dataUtilsLayer
      ],
      mainTable: mainTable,
    });

    const webSocketResources = new WebSocketResources(this, 'WebSocketResources', {
      env: props.env,
      wsApi: webSocketApi,
      lambda: lambda,
      layers: [
        baseLayer,
        awsUtilsLayer,
      ],
      pubsubTable: pubsubTable
    });

  }
}

module.exports = {
  ReserveRecCdkStack,
  lambda,
};
