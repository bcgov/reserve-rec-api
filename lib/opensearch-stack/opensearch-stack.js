const { Aws, RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const opensearch = require('aws-cdk-lib/aws-opensearchservice');
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const { logger } = require('../helpers/utils');
const { InitOpenSearchConstruct } = require('./init-opensearch/constructs');

const defaults = {
  description: 'OpenSearch stack managing OpenSearch domain, indexes, roles, and related resources for the Reserve Recreation APIs.',
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
    opensearchTransactionalDataIndexName: 'transactional-data-index',
    opensearchUserIndexName: 'user-index',
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
    const transactionIndexName = scope.resolveOpenSearchTransactionalDataIndexName(this);
    const userIndexName = scope.resolveOpenSearchUserIndexName(this);

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

    // Create OpenSearch Master Role
    this.osMasterRole = new iam.Role(this, this.getConstructId('osMasterRole'), {
      roleName: this.getConstructId('osMasterRole'),
      assumedBy: new iam.ServicePrincipal('es.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceFullAccess')
      ],
      inlinePolicies: {
        OpenSearchServicePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'es:ESHttp*'
              ],
              resources: [
                this.osDomainArn,
                `${this.osDomainArn}/*`
              ],
            })
          ]
        })
      }
    });

    // OpenSearch Deployment
    // Note: Refer to the README for configuring Cognito authentication for OpenSearch Dashboards.
    this.openSearchDomain = null;

    // TL:DR Deployment order:
    // 1. If domain already created, import it using ARN/Endpoint overrides:
    //   1.1. In Parameter Store/openSearchStack/config, set overrides.opensearchDomainArn and overrides.opensearchDomainEndpoint
    // 2. Else create new domain:
    //   2.1. Ensure no overrides set in Parameter Store/openSearchStack/config for opensearchDomainArn/Endpoint
    //   2.2. Deploy stack as is to create new OpenSearch domain
    //   2.3. After deployment, note the Domain ARN/Endpoint outputs
    //   2.4. For future deployments, set the overrides.opensearchDomainArn/Endpoint in Parameter Store/openSearchStack/config to import existing domain
    //   2.5. Manually set up OpenSearch Dashboards FGAC. Login as master user. Give superadmin group all_access and security_manager roles.
    //   2.6. Assign superadmin group to admin users in Cognito User Pool
    //   2.7. Manually change OpenSearch Service security settings:
    //    - 2.7.1 Set IAM ARN as master user, use the osMasterRole role ARN
    //    - 2.7.2 Enable Cognito authentication.
    //    - 2.7.3 Enable "Allow open access to the domain" (FGAC only)
    //    - 2.7.4 Save changes and restart domain

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
          // Switch to masterRoleArn and comment out master username/password after initial setup
          // masterRoleArn: this.osMasterRole.roleArn,
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
        OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: transactionIndexName,
        OPENSEARCH_USER_INDEX_NAME: userIndexName,
      },
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      openSearchDomainArn: this.getOpenSearchDomainArn(),
    });

    // Export References

    // OpenSearch Domain ARN
    this.exportReference(this, 'openSearchDomainArn', this.openSearchDomain.domainArn, `ARN of the OpenSearch Domain in ${this.stackId}`);

    // OpenSearch Domain Endpoint
    this.exportReference(this, 'openSearchDomainEndpoint', this.openSearchDomain.domainEndpoint, `Endpoint of the OpenSearch Domain in ${this.stackId}`);

    // OpenSearch Reference Data Index Name
    this.exportReference(this, 'openSearchReferenceDataIndexName', referenceIndexName, `Name of the OpenSearch Reference Data Index in ${this.stackId}`);

    // OpenSearch Transaction Index Name
    this.exportReference(this, 'openSearchTransactionalDataIndexName', transactionIndexName, `Name of the OpenSearch Transactional Data Index in ${this.stackId}`);

    // OpenSearch User Index Name
    this.exportReference(this, 'openSearchUserIndexName', userIndexName, `Name of the OpenSearch User Index in ${this.stackId}`);

    // OpenSearch MasterUser Role ARN
    this.exportReference(this, 'openSearchMasterRoleArn', this.osMasterRole.roleArn, `ARN of the OpenSearch Master User Role in ${this.stackId}`);

    // Bind resolve functions to scope for other stacks to consume
    scope.resolveOpenSearchDomainArn = this.resolveOpenSearchDomainArn.bind(this);
    scope.resolveOpenSearchDomainEndpoint = this.resolveOpenSearchDomainEndpoint.bind(this);
    scope.resolveOpenSearchTransactionalDataIndexName = this.resolveOpenSearchTransactionalDataIndexName.bind(this);
    scope.resolveOpenSearchReferenceDataIndexName = this.resolveOpenSearchReferenceDataIndexName.bind(this);
    scope.resolveOpenSearchUserIndexName = this.resolveOpenSearchUserIndexName.bind(this);
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

  resolveOpenSearchTransactionalDataIndexName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('openSearchTransactionalDataIndexName'));
  }

  resolveOpenSearchUserIndexName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('openSearchUserIndexName'));
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