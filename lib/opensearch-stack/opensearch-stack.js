const { Aws, RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const opensearch = require('aws-cdk-lib/aws-opensearchservice');
const { StackPrimer } = require('../helpers/utils');
const { BaseStack } = require('../helpers/base-stack');
const { logger } = require('../helpers/utils');
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
    opensearchDataNodeCount: 2,
    opensearchInstanceType: 't3.small.search',
    opensearchEbsVolumeIops: '3000',
    opensearchEbsVolumeThroughput: '125',
    logLevel: process.env.LOG_LEVEL || 'info',
    importedDomainArn: '',
    importedDomainEndpoint: '',
    opensearchReferenceDataIndexName: 'reference-data-index',
    opensearchBookingIndexName: 'booking-index',
    overrides: {
      opensearchDomainArn: '',
      opensearchDomainEndpoint: '',
    }
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

    const baseLayer = scope.resolveBaseLayer(this);
    const awsUtilsLayer = scope.resolveAwsUtilsLayer(this);
    const kmsKey = scope.resolveKmsKey(this);

    // OpenSearch Indexes
    const referenceIndexName = scope.resolveOpenSearchReferenceDataIndexName(this);
    const bookingIndexName = scope.resolveOpenSearchBookingIndexName(this);

    // Setup OpenSearch Cluster
    this.osDomainArn = this.createSearchDomainArn();

    // Create IAM Roles for OpenSearch access that integrate with existing Cognito User Pools

    const adminIdentityPoolRef = scope.resolveAdminIdentityPoolId(this);
    if (!adminIdentityPoolRef) {
      throw new Error('OpenSearchStack: Admin Identity Pool ID not found in scope. Ensure AdminIdentityPool is created before OpenSearchStack.');
    }

    const adminUserPoolId = scope.resolveAdminUserPoolId(this);
    if (!adminUserPoolId) {
      throw new Error('OpenSearchStack: Admin User Pool ID not found in scope. Ensure AdminUserPool is created before OpenSearchStack.');
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

    // OpenSearch Deployment
    // Note: Refer to the README for configuring Cognito authentication for OpenSearch Dashboards.
    this.openSearchDomain = null;

    // If imported domain properties are provided, import existing domain instead of creating a new one (saves considerable time)
    if (this.overrides?.opensearchDomainArn && this.overrides?.opensearchDomainEndpoint) {
      logger.info(`Importing existing OpenSearch Domain: ${this.overrides.opensearchDomainArn}`);
      this.openSearchDomain = opensearch.Domain.fromDomainAttributes(this, `${this.getConstructId('openSearchDomain')}-Imported`, {
        domainArn: this.overrides.opensearchDomainArn,
        domainEndpoint: this.overrides.opensearchDomainEndpoint,
      });
    } else {
      // Else if no imported domain properties, create new domain
      logger.info('Creating new OpenSearch Domain');
      this.openSearchDomain = new opensearch.Domain(this, this.getConstructId('openSearchDomain'), {
        domainName: `${this.getConfigValue('opensearchDomainPrefix')}-${this.getDeploymentName()}`,
        version: opensearch.EngineVersion.OPENSEARCH_2_17,
        capacity: {
          dataNodes: this.getConfigValue('opensearchDataNodeCount'),
          dataNodeInstanceType: this.getConfigValue('opensearchInstanceType'),
          multiAzWithStandbyEnabled: false,
        },
        enforceHttps: true,
        nodeToNodeEncryption: true,
        encryptionAtRest: {
          enabled: true,
          kmsKey: kmsKey,
        },
        enableVersionUpgrade: true,
        ebs: {
          enabled: true,
          volumeSize: 10,
          volumeType: 'gp3',
          iops: parseInt(this.getConfigValue('opensearchEbsVolumeIops'), 10) || 3000,
          throughput: parseInt(this.getConfigValue('opensearchEbsVolumeThroughput'), 10) || 125,
        },
        fineGrainedAccessControl: {
          masterUserName: 'admin',
          masterUserPassword: scope.getSecretValue('opensearchMasterUserPassword'),
        },
        cognitoDashboardsAuth: {
          identityPoolId: adminIdentityPoolRef,
          userPoolId: adminUserPoolId,
          role: this.osCognitoRole, // Use service role
        },
        zoneAwareness: {
          enabled: false
        },
        removalPolicy: RemovalPolicy.RETAIN,
      });
    }


    // Add OpenSearch index initializer Lambda function
    this.initOpenSearchConstruct = new InitOpenSearchConstruct(this, this.getConstructId('osInitOpenSearchConstruct'), {
      environment: {
        LOG_LEVEL: this.getConfigValue('logLevel'),
        OPENSEARCH_DOMAIN_ENDPOINT: `https://${this.openSearchDomain.domainEndpoint}`,
        OPENSEARCH_REFERENCE_DATA_INDEX_NAME: referenceIndexName,
        OPENSEARCH_BOOKING_INDEX_NAME: bookingIndexName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
    });

    // Export References

    // OpenSearch Domain ARN
    this.exportReference(this, 'openSearchDomainArn', this.openSearchDomain.domainArn, `ARN of the OpenSearch Domain in ${this.stackId}`);

    // OpenSearch Domain Endpoint
    this.exportReference(this, 'openSearchDomainEndpoint', this.openSearchDomain.domainEndpoint, `Endpoint of the OpenSearch Domain in ${this.stackId}`);

    // OpenSearch Reference Data Index Name
    this.exportReference(this, 'openSearchReferenceDataIndexName', referenceIndexName, `Name of the OpenSearch Reference Data Index in ${this.stackId}`);

    // OpenSearch Booking Index Name
    this.exportReference(this, 'openSearchBookingIndexName', bookingIndexName, `Name of the OpenSearch Booking Index in ${this.stackId}`);

    // Bind resolve functions to scope for other stacks to consume
    scope.resolveOpenSearchDomainArn = this.resolveOpenSearchDomainArn.bind(this);
    scope.resolveOpenSearchDomainEndpoint = this.resolveOpenSearchDomainEndpoint.bind(this);
    scope.resolveOpenSearchBookingIndexName = this.resolveOpenSearchBookingIndexName.bind(this);
    scope.resolveOpenSearchReferenceDataIndexName = this.resolveOpenSearchReferenceDataIndexName.bind(this);
  }

  createSearchDomainArn() {
    return `arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${this.getConfigValue('opensearchDomainPrefix')}-${this.getDeploymentName()}`;
  }

  getOpenSearchDomainArn() {
    return this.osDomainArn;
  }

  resolveOpenSearchDomainArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('openSearchDomainArn'));
  }

  resolveOpenSearchDomainEndpoint(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('openSearchDomainEndpoint'));
  }

  resolveOpenSearchReferenceDataIndexName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('openSearchReferenceDataIndexName'));
  }

  resolveOpenSearchBookingIndexName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('openSearchBookingIndexName'));
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