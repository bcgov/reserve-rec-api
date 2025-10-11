const { RemovalPolicy } = require('aws-cdk-lib');
const { logger, StackPrimer } = require("../utils");
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const { BaseStack } = require('../base-stack');

const defaults = {
  constructs: {
    adminGroup: {
      name: 'Administrators',
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
    stackOwner: "osprey"
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

async function createAdminIdentityStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new AdminIdentityStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Admin Identity Stack: ${error}`);
  }
}

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

    // Attach roles to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: this.adminIdentityPool.ref,
      roles: {
        authenticated: this.cognitoAuthRole.roleArn,
        unauthenticated: this.cognitoUnauthRole.roleArn,
      }
    });

    // Create a cognito user group for system administrators
    this.adminGroup = new cognito.CfnUserPoolGroup(this, this.getConstructId('adminGroup'), {
      groupName: this.getConstructId('adminGroup'),
      userPoolId: this.adminUserPool.userPoolId,
      description: 'System administrators group',
      precedence: 1
    });

    // Create a cognito user group for park operators
    this.parkOperatorGroup = new cognito.CfnUserPoolGroup(this, this.getConstructId('parkOperatorGroup'), {
      groupName: this.getConstructId('parkOperatorGroup'),
      userPoolId: this.adminUserPool.userPoolId,
      description: 'Park operators group',
      precedence: 2
    });

    // Expose getters for other stacks to access resources
    scope.getAdminUserPoolId = this.getAdminUserPoolId.bind(this);
    scope.getAdminUserPoolClientId = this.getAdminUserPoolClientId.bind(this);
    scope.getAdminCognitoDomain = this.getAdminCognitoDomain.bind(this);

  }

  createDomainPrefix() {
    const prefix = this.getConfigValue('domainPrefix');
    return `${prefix}-${this.getDeploymentName()}`.toLowerCase();
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

}

module.exports = {
  createAdminIdentityStack,
};