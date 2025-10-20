const { Aws, RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const opensearch = require('aws-cdk-lib/aws-opensearchservice');
const { StackPrimer } = require('../utils');
const { BaseStack } = require('../base-stack');
const { logger } = require('../utils');
const { InitOpenSearchConstruct } = require('./init-opensearch/constructs');

const defaults = {
  constructs: {
    openSearchDomain: {
      name: 'OpenSearchDomain',
    },
    osAdminRole: {
      name: 'OpenSearchAdminRole',
    },
    osAdminReadOnlyRole: {
      name: 'OpenSearchAdminReadOnlyRole',
    },
    osPublicRole: {
      name: 'OpenSearchPublicRole',
    },
    osCognitoRole: {
      name: 'OpenSearchCognitoRole',
    },
    osMasterRole: {
      name: 'OpenSearchMasterRole',
    },
    osAdminGroup: {
      name: 'OpenSearchAdminGroup',
    },
    osAdminReadOnlyRole: {
      name: 'OpenSearchAdminReadOnlyRole',
    },
    osPublicGroup: {
      name: 'OpenSearchPublicGroup',
    },
    osInitOpenSearchConstruct: {
      name: 'InitOpenSearchConstruct',
    }
  },
  config: {
    opensearchDomainPrefix: 'reserve-rec-opensearch',
    opensearchDataNodeCount: 1,
    opensearchInstanceType: 't3.small.search',
    opensearchEbsVolumeIops: '3000',
    opensearchEbsVolumeThroughput: '125',
    opensearchReferenceDataIndexName: 'reference-data',
    opensearchBookingIndexName: 'bookings',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  secrets: {
    opensearchMasterUserPassword: {
      name: 'OpensearchMasterUserPassword',
    },
  }
};

class OpenSearchStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating OpenSearch Stack: ${this.stackId}`);

    // Setup OpenSearch Cluster
    this.osDomainArn = `arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${this.getConfigValue('opensearchDomainPrefix')}-${this.getDeploymentName()}`;

    // Create IAM Roles for OpenSearch access that integrate with existing Cognito User Pools

    const adminIdentityPoolRef = scope.getAdminIdentityPoolRef();
    if (!adminIdentityPoolRef) {
      throw new Error('ReferenceDataStack: Admin Identity Pool ID not found in scope. Ensure AdminIdentityPool is created before ReferenceDataStack.');
    }

    // Grant OpenSearch access to administrative roles

    const superAdminRole = scope.getRoleByKey('superAdmin');
    superAdminRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceFullAccess'));
    superAdminRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['es:ESHttp*'],
      resources: [`${this.osDomainArn}*`]
    }));

    const administratorRole = scope.getRoleByKey('administrator');
    administratorRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceReadOnlyAccess'));
    administratorRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpHead'
      ],
      resources: [this.osDomainArn, `${this.osDomainArn}/*`],
      conditions: {
        StringLike: {
          'es:index': ['*'] // Can be restricted to specific indices if needed
        }
      }
    }));

    // Grant OpenSearch access to public roles

    const publicRole = scope.getRoleByKey('public');
    publicRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceReadOnlyAccess'));
    publicRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'es:ESHttpGet',
        'es:ESHttpPost',
        'es:ESHttpHead'
      ],
      resources: [this.osDomainArn, `${this.osDomainArn}/*`],
      conditions: {
        StringLike: {
          'es:index': ['*'] // Can be restricted to specific indices if needed
        }
      }
    }));

    // Service-linked role for OpenSearch Cognito integration
    this.osCognitoRole = new iam.Role(this, this.getConstructId('osCognitoRole'), {
      roleName: this.getConstructId('osCognitoRole'),
      assumedBy: new iam.ServicePrincipal('opensearchservice.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceCognitoAccess')
      ],
      inlinePolicies: {
        OpenSearchServicePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cognito-identity:ListIdentityPools',
                'cognito-identity:DescribeIdentityPool',
                'cognito-idp:ListUserPools',
                'cognito-idp:DescribeUserPool',
                'cognito-idp:DescribeUserPoolClient',
                'cognito-idp:ListUserPoolClients'
              ],
              resources: ['*']
            })
          ]
        })
      }
    });

    scope.addRole('osCognito', this.osCognitoRole);

    // Create Master Role for OpenSearch Dashboards access
    this.osMasterRole = new iam.Role(this, this.getConstructId('osMasterRole'), {
      roleName: this.getConstructId('osMasterRole'),
      assumedBy: new iam.ServicePrincipal('opensearchservice.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceFullAccess')
      ],
    });

    scope.addRole('osMaster', this.osMasterRole);

    // OpenSearch Access policy
    // const osAccessPolicy = new iam.PolicyStatement({
    //   effect: iam.Effect.ALLOW,
    //   principals: [
    //     new iam.AccountRootPrincipal(),
    //     scope.getCognitoAuthRole(),
    //     this.dynamoStreamRole,
    //     this.osAdminRole,
    //     this.osCognitoRole
    //   ],
    //   actions: [
    //     'es:ESHttp*',
    //   ],
    //   resources: [this.osDomainArn, `${this.osDomainArn}/*`],
    // });


    // OpenSearch Deployment
    // Note: Refer to the README for configuring Cognito authentication for OpenSearch Dashboards.
    this.openSearchDomain = new opensearch.Domain(this, this.getConstructId('openSearchDomain'), {
      domainName: `${this.getConfigValue('opensearchDomainPrefix')}-${this.getDeploymentName()}`,
      version: opensearch.EngineVersion.OPENSEARCH_2_17,
      // accessPolicies: [osAccessPolicy],
      capacity: {
        dataNodes: this.getConfigValue('opensearchDataNodeCount'),
        dataNodeInstanceType: this.getConfigValue('opensearchInstanceType'),
        multiAzWithStandbyEnabled: false,
      },
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: {
        enabled: true,
        kmsKey: scope.getKmsKey(),
      },
      enableVersionUpgrade: true,
      ebs: {
        enabled: true,
        volumeSize: 10,
        volumeType: 'gp3',
        iops: parseInt(this.getConfigValue('opensearchEbsVolumeIops'), 10) || 3000,
        throughput: parseInt(this.getConfigValue('opensearchEbsVolumeThroughput'), 10) || 125,
      },
      // fineGrainedAccessControl: {
      //   masterUserName: 'admin',
      //   masterUserPassword: scope.getSecretValue('opensearchMasterUserPassword'),
      // },
      cognitoDashboardsAuth: {
        identityPoolId: adminIdentityPoolRef,
        userPoolId: scope.getAdminUserPoolId(),
        role: this.osCognitoRole, // Use service role
      },
      zoneAwareness: {
        enabled: false
      },
      removalPolicy: RemovalPolicy.RETAIN,
      // logging: {
      //   appLogEnabled: true,
      //   appLogGroup: this.logGroup,
      //   slowSearchLogEnabled: true,
      //   slowSearchLogGroup: this.logGroup,
      //   slowIndexLogEnabled: true,
      //   slowIndexLogGroup: this.logGroup,
      // }
    });


    // Add OpenSearch index initializer Lambda function
    this.initOpenSearchConstruct = new InitOpenSearchConstruct(this, this.getConstructId('osInitOpenSearchConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        OPENSEARCH_DOMAIN_ENDPOINT: this.openSearchDomain.domainEndpoint,
        OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.getConfigValue('opensearchMainIndexName'),
        OPENSEARCH_BOOKING_INDEX_NAME: this.getConfigValue('opensearchBookingIndexName'),
      },
      layers: [
        scope.getBaseLayer(),
      ],
    });

    scope.getOpenSearchDomainArn = this.getOpenSearchDomainArn.bind(this);

    // Cfn Outputs
    new CfnOutput(this, `${this.getConstructId('openSearchDomain')}CfnOutput`, {
      value: this.openSearchDomain.domainArn,
      exportName: `${this.getCfnPath('openSearchDomain')}-domainArn`
    });

    new CfnOutput(this, `${this.getConstructId('openSearchDomainEndpoint')}CfnOutput`, {
      value: this.openSearchDomain.domainEndpoint,
      exportName: `${this.getCfnPath('openSearchDomainEndpoint')}-domainEndpoint`
    });

  }

  getOpenSearchDomainArn() {
    return this.osDomainArn;
  }
}

async function createOpenSearchStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new OpenSearchStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating OpenSearch Stack: ${error}`);
  }
}

module.exports = { createOpenSearchStack };