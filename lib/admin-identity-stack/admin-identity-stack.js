const { RemovalPolicy, CfnOutput } = require('aws-cdk-lib');
const { logger, StackPrimer } = require("../utils");
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const { BaseStack } = require('../base-stack');
const adminRoles = require('./admin-roles.json');

const defaults = {
  constructs: {
    adminGroup: {
      name: 'Administrators',
    },
    osAdminGroup: {
      name: 'OpenSearchAdministrators',
    },
    adminUserPool: {
      name: 'AdminUserPool',
    },
    adminUserPoolClient: {
      name: 'AdminUserPoolClient',
    },
    adminUserPoolDomain: {
      name: 'UserPoolDomain',
    },
    adminIdentityPool: {
      name: 'AdminIdentityPool',
    },
    azureOIDCProvider: {
      name: 'AzureOIDCProvider',
      strictName: true,
    },
    bcscOIDCProvider: {
      name: 'BCSCOIDCProvider',
    },
    cognitoAuthRole: {
      name: 'CognitoAuthRole',
    },
    cognitoUnauthRole: {
      name: 'CognitoUnauthRole',
    },
    parkOperatorGroup: {
      name: 'ParkOperators',
    }
  },
  config: {
    azureAllowedOAuthFlows: [
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_CUSTOM_AUTH"
    ],
    azureCallbackUrls: [
      "http://localhost:4300"
    ],
    azureClientId: "azure-client-id",
    azureIssuerUrl: " azure-oidc-url",
    azureLogoutUrls: [
      "http://localhost:4300/logout"
    ],
    bcscClientId: "bcsc-client-id",
    bcscIssuerUrl: "bcsc-oidc-url",
    domainPrefix: "reserve-rec-admin-identity",
    poolDeletionProtection: false,
    ssmConstructOverrides: {},
    stackOwner: "osprey",
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  secrets: {
    azureClientSecret: {
      name: "AzureClientSecret"
    },
    bcscClientSecret: {
      name: "BCSCClientSecret"
    }
  }
};



class AdminIdentityStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Admin Identity Stack: ${primer.stackId}`);

    // Create an administrative Cognito User Pool
    this.adminUserPool = new cognito.UserPool(this, this.getConstructId('adminUserPool'), {
      userPoolName: this.getConstructId('adminUserPool'),
      selfSignUpEnabled: false,
      deletionProtection: this.getConfigValue('poolDeletionProtection') === 'true' ? true : false,
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Create Azure OIDC provider (using AzureIDIR as the provider name override)
    this.azureOIDCProvider = new cognito.UserPoolIdentityProviderOidc(this, this.getConstructId('azureOIDCProvider'), {
      userPool: this.adminUserPool,
      name: this.getConstructId('azureOIDCProvider'),
      clientId: this.getConfigValue('azureClientId'),
      clientSecret: this.getSecretValue('azureClientSecret'),
      attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
      issuerUrl: this.getConfigValue('azureIssuerUrl'),
      scopes: ['openid', 'profile', 'email'],
      attributeMapping: {
        email: cognito.ProviderAttribute.other("email"),
      }
    });

    // Create an app client for the admin user pool
    this.adminUserPoolClient = new cognito.UserPoolClient(this, this.getConstructId('adminUserPoolClient'), {
      userPool: this.adminUserPool,
      userPoolClientName: this.getConstructId('adminUserPoolClient'),
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
        ],
        callbackUrls: this.getConfigValue('azureCallbackUrls'),
        logoutUrls: this.getConfigValue('azureLogoutUrls'),
      },
      allowedOAuthFlows: [this.getConfigValue('azureAllowedOAuthFlows')],
      enableTokenRevocation: true,
    });

    // Create an identity pool for federated access
    this.adminIdentityPool = new cognito.CfnIdentityPool(this, this.getConstructId('adminIdentityPool'), {
      identityPoolName: this.getConstructId('adminIdentityPool'),
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.adminUserPoolClient.userPoolClientId,
          providerName: this.adminUserPool.userPoolProviderName,
        }
      ]
    });

    // Create a user pool domain
    this.adminUserPoolDomain = new cognito.UserPoolDomain(this, this.getConstructId('adminUserPoolDomain'), {
      userPool: this.adminUserPool,
      cognitoDomain: {
        domainPrefix: this.createDomainPrefix(this)
      }
    });

    // Create authenticated IAM role
    this.cognitoAuthRole = new iam.Role(this, this.getConstructId('cognitoAuthRole'), {
      roleName: this.getConstructId('cognitoAuthRole'),
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': this.adminIdentityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
      ]
    });

    // Create unauthenticated IAM role
    this.cognitoUnauthRole = new iam.Role(this, this.getConstructId('cognitoUnauthRole'), {
      roleName: this.getConstructId('cognitoUnauthRole'),
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: { 'cognito-identity.amazonaws.com:aud': this.adminIdentityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
      ]
    });

    // Create administrative roles and user groups
    for (const [roleKey, roleConfig] of Object.entries(adminRoles)) {
      logger.debug(`Creating role and group for: ${roleKey}`);

      // Create IAM Role
      const roleName = primer.createConstructId({ name: roleConfig.roleName });
      const rolePath = primer.createConstructCfnOutputPath(roleConfig.roleName);
      const iamRole = new iam.Role(this, roleName, {
        roleName: roleName,
        description: roleConfig.description,
        assumedBy: new iam.FederatedPrincipal(
          'cognito-identity.amazonaws.com',
          {
            'StringEquals': { 'cognito-identity.amazonaws.com:aud': this.adminIdentityPool.ref },
            'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
          },
          'sts:AssumeRoleWithWebIdentity'
        )
      });

      // Create Cognito User Group
      const groupName = primer.createConstructId({ name: roleConfig.groupName });
      const userGroup = new cognito.CfnUserPoolGroup(this, groupName, {
        groupName: groupName,
        userPoolId: this.adminUserPool.userPoolId,
        description: roleConfig.description,
        role: iamRole,
      });

      scope.addGroupWithRole(roleKey, userGroup, iamRole);

      // Export role name as Cfn Output
      new CfnOutput(this, `${roleName}-CfnOutput`, {
        value: iamRole.roleArn,
        exportName: `${rolePath}-roleArn`
      });
    }

    // Expose getters for other stacks to access resources
    scope.getAdminUserPoolId = this.getAdminUserPoolId.bind(this);
    scope.getAdminUserPool = this.getAdminUserPool.bind(this);
    scope.getAdminUserPoolClientId = this.getAdminUserPoolClientId.bind(this);
    scope.getAdminCognitoDomain = this.getAdminCognitoDomain.bind(this);
    scope.getAdminIdentityPoolRef = this.getAdminIdentityPoolRef.bind(this);
    scope.getCognitoAuthRole = this.getCognitoAuthRole.bind(this);
    scope.getCognitoUnauthRole = this.getCognitoUnauthRole.bind(this);


    // Cfn Outputs
    new CfnOutput(this, `${this.getConstructId('adminUserPool')}CfnOutput`, {
      value: this.getAdminUserPool().userPoolId,
      exportName: `${this.getCfnPath('adminUserPool')}-userPoolId`
    });

    new CfnOutput(this, `${this.getConstructId('adminUserPoolClient')}CfnOutput`, {
      value: this.adminUserPoolClient.userPoolClientId,
      exportName: `${this.getCfnPath('adminUserPoolClient')}-userPoolClientId`
    });

    new CfnOutput(this, `${this.getConstructId('adminUserPoolDomain')}CfnOutput`, {
      value: this.getAdminCognitoDomain(),
      exportName: `${this.getCfnPath('adminUserPoolDomain')}-domainName`
    });

    new CfnOutput(this, `${this.getConstructId('adminIdentityPool')}CfnOutput`, {
      value: this.getAdminIdentityPoolRef(),
      exportName: `${this.getCfnPath('adminIdentityPool')}-identityPoolId`
    });

  }

  createDomainPrefix() {
    const prefix = this.getConfigValue('domainPrefix');
    return `${prefix}-${this.getDeploymentName()}`.toLowerCase();
  }

  getAdminUserPool() {
    return this.adminUserPool;
  }

  getAdminUserPoolId() {
    return this.adminUserPool.userPoolId;
  }

  getAdminUserPoolClientId() {
    return this.adminUserPoolClient.userPoolClientId;
  }

  getAdminCognitoDomain() {
    return this.adminUserPoolDomain.domainName;
  }

  getAdminIdentityPoolRef() {
    return this.adminIdentityPool.ref;
  }

  getCognitoAuthRole() {
    return this.cognitoAuthRole;
  }

  getCognitoUnauthRole() {
    return this.cognitoUnauthRole;
  }

}

async function createAdminIdentityStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new AdminIdentityStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Admin Identity Stack: ${error}`);
  }
}

module.exports = {
  createAdminIdentityStack,
};