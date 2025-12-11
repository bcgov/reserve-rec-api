const { RemovalPolicy, CfnJson } = require('aws-cdk-lib');
const { logger } = require("../helpers/utils");
const { StackPrimer } = require("../helpers/stack-primer");
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');
const { BaseStack } = require('../helpers/base-stack');
const adminRoles = require('./admin-roles.json');

const defaults = {
  description: 'Admin Identity stack managing Cognito User Pool, Identity Pool, OIDC providers, and related IAM roles for administrative access to the Reserve Recreation APIs.',
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
    },
    adminIdentityPoolRoleAttachment: {
      name: 'AdminIdentityPoolRoleAttachment',
    }
  },
  config: {
    azureAllowedOAuthFlows: [
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_CUSTOM_AUTH"
    ],
    azureCallbackUrls: [
      "http://localhost:4200",
      "http://localhost:4300"
    ],
    azureClientId: "azure-client-id",
    azureIssuerUrl: " azure-oidc-url",
    azureLogoutUrls: [
      "http://localhost:4300/logout",
      "http://localhost:4200/logout"
    ],
    bcscClientId: "bcsc-client-id",
    bcscIssuerUrl: "bcsc-oidc-url",
    bcscAuthorizationEndpoint: "bcscAuthorizationEndpoint",
    bcscTokenEndpoint: "bcscTokenEndpoint",
    bcscUserInfoEndpoint: "bcscUserInfoEndpoint",
    bcscJwksUri: "bcscJwksUri",
    domainPrefix: "reserve-rec-admin-identity",
    poolDeletionProtection: false,
    ssmConstructOverrides: {},
    stackOwner: "osprey",
    logLevel: process.env.LOG_LEVEL || 'info',
    openSearchCognitoClientId: "",
    azureProviderFriendlyName: "IDIR",
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
    const azureProviderName = this.getConfigValue('azureProviderFriendlyName') ? this.getConfigValue('azureProviderFriendlyName') : this.getConstructId('azureOIDCProvider');
    this.azureOIDCProvider = new cognito.UserPoolIdentityProviderOidc(this, this.getConstructId('azureOIDCProvider'), {
      userPool: this.adminUserPool,
      name: azureProviderName,
      clientId: this.getConfigValue('azureClientId'),
      clientSecret: this.getSecretValue('azureClientSecret'),
      attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
      issuerUrl: this.getConfigValue('azureIssuerUrl'),
      scopes: ['openid', 'profile', 'email'],
      attributeMapping: {
        email: cognito.ProviderAttribute.other("email"),
      }
    });

    this.bcscOIDCProvider = new cognito.UserPoolIdentityProviderOidc(this, this.getConstructId('bcscOIDCProvider'), {
        userPool: this.adminUserPool,
        name: 'BCSC',
        clientId: this.getConfigValue('bcscClientId'),
        clientSecret: this.getSecretValue('bcscClientSecret'),
        attributeRequestMethod: cognito.OidcAttributeRequestMethod.GET,
        issuerUrl: this.getConfigValue('bcscIssuerUrl'),
        endpoints: {
          authorization: this.getConfigValue('bcscAuthorizationEndpoint'),
          token: this.getConfigValue('bcscTokenEndpoint'),
          userInfo: this.getConfigValue('bcscUserInfoEndpoint'),
          jwksUri: this.getConfigValue('bcscJwksUri') || 'https://idtest.gov.bc.ca/oauth2/jwks'
        },
        scopes: ['openid', 'profile', 'email'],
        attributeMapping: {
          email: cognito.ProviderAttribute.other("email"),
          givenName: cognito.ProviderAttribute.other("given_name"),
          familyName: cognito.ProviderAttribute.other("family_name"),
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
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.custom(this.azureOIDCProvider.providerName),
        cognito.UserPoolClientIdentityProvider.custom('BCSC'),
      ],
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: this.getConfigValue('azureCallbackUrls'),
        logoutUrls: this.getConfigValue('azureLogoutUrls'),
      },
      customAttributes: {
        adminRole: new cognito.StringAttribute({ mutable: true }),
      },
      //allowedOAuthFlows: [this.getConfigValue('azureAllowedOAuthFlows')],
      enableTokenRevocation: true,
    });


    // Add dependencies to ensure providers exist before client
    this.adminUserPoolClient.node.addDependency(this.azureOIDCProvider);
    this.adminUserPoolClient.node.addDependency(this.bcscOIDCProvider);

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
    this.adminRoleMappings = {};
    let roleMappingRules = [];
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

      roleMappingRules.push({
        Claim: 'cognito:groups',
        MatchType: 'Contains',
        Value: groupName,
        RoleARN: iamRole.roleArn,
      });

      scope.addGroupWithRole(roleKey, userGroup, iamRole);

      // Export Role Reference
      this.exportReference(this, `${roleKey}RoleArn`, iamRole.roleArn, `ARN of the ${roleKey} role in ${this.stackId}`);
    }

    const adminProviderString = `${this.adminUserPool.userPoolProviderName}:${this.adminUserPoolClient.userPoolClientId}`;

    this.adminRoleMappings[adminProviderString] = {
      Type: 'Rules',
      AmbiguousRoleResolution: 'AuthenticatedRole',
      RulesConfiguration: {
        Rules: roleMappingRules
      }
    };

    // Manually add the OpenSearch Dashboards Cognito mapping (because OpenSearch automatically generates a different client ID)
    if (this.getConfigValue('openSearchCognitoClientId')) {
      const openSearchCognitoClientId = this.getConfigValue('openSearchCognitoClientId');
      const openSearchProviderString = `${this.adminUserPool.userPoolProviderName}:${openSearchCognitoClientId}`;
      logger.debug('OpenSearch Provider String:', openSearchProviderString);

      this.adminRoleMappings[openSearchProviderString] = {
        Type: 'Rules',
        AmbiguousRoleResolution: 'AuthenticatedRole',
        RulesConfiguration: {
          Rules: [
            {
              Claim: 'cognito:groups',
              MatchType: 'Contains',
              Value: scope.getGroupByKey('superAdmin').groupName,
              RoleARN: scope.getRoleByKey('superAdmin').roleArn,
            }
          ]
        }
      };
    } else {
      logger.warn('No OpenSearch Cognito Client ID configured; skipping OpenSearch role mapping.');
    }

    this.adminRoleMappingJson = new CfnJson(this, 'AdminRoleMappingJson', {
      value: this.adminRoleMappings
    });

    // Create role mappings for admin identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'AdminIdentityPoolRoleAttachment', {
      identityPoolId: this.adminIdentityPool.ref,
      roles: {
        authenticated: this.cognitoAuthRole.roleArn,
        unauthenticated: this.cognitoUnauthRole.roleArn
      },
      roleMappings: this.adminRoleMappingJson
    });


    // Export References

    // Admin User Pool Id
    this.exportReference(this, 'adminUserPoolId', this.adminUserPool.userPoolId, `ID of the Admin User Pool in ${this.stackId}`);

    // Admin User Pool Client ID
    this.exportReference(this, 'adminUserPoolClientId', this.adminUserPoolClient.userPoolClientId, `ID of the Admin User Pool Client in ${this.stackId}`);

    // Admin Identity Pool ID
    this.exportReference(this, 'adminIdentityPoolId', this.adminIdentityPool.ref, `ID of the Admin Identity Pool in ${this.stackId}`);

    // Admin User Pool Domain
    this.exportReference(this, 'adminUserPoolDomain', this.getAdminCognitoDomain(), `Domain of the Admin User Pool in ${this.stackId}`);

    // Admin User Pool Provider Name
    this.exportReference(this, 'adminUserPoolProviderName', this.adminUserPool.userPoolProviderName, `Provider Name of the Admin User Pool in ${this.stackId}`);

    // Authenticated Cognito Role ARN
    this.exportReference(this, 'cognitoAuthRoleArn', this.cognitoAuthRole.roleArn, `ARN of the Cognito Authenticated Role in ${this.stackId}`);

    // Unauthenticated Cognito Role ARN
    this.exportReference(this, 'cognitoUnauthRoleArn', this.cognitoUnauthRole.roleArn, `ARN of the Cognito Unauthenticated Role in ${this.stackId}`);

    // Bind resolve functions to scope for other stacks to consume
    scope.resolveAdminUserPoolId = this.resolveAdminUserPoolId.bind(this);
    scope.resolveAdminUserPoolClientId = this.resolveAdminUserPoolClientId.bind(this);
    scope.resolveAdminIdentityPoolId = this.resolveAdminIdentityPoolId.bind(this);
    scope.resolveAdminUserPoolProviderName = this.resolveAdminUserPoolProviderName.bind(this);
    scope.resolveAdminAuthenticatedCognitoRoleArn = this.resolveAdminAuthenticatedCognitoRoleArn.bind(this);
    scope.resolveAdminUnauthenticatedCognitoRoleArn = this.resolveAdminUnauthenticatedCognitoRoleArn.bind(this);

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

  resolveAdminUserPoolId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('adminUserPoolId'));
  }

  resolveAdminUserPoolClientId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('adminUserPoolClientId'));
  }

  resolveAdminIdentityPoolId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('adminIdentityPoolId'));
  }

  resolveAdminUserPoolProviderName(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('adminUserPoolProviderName'));
  }

  resolveAdminAuthenticatedCognitoRoleArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('cognitoAuthRoleArn'));
  }

  resolveAdminUnauthenticatedCognitoRoleArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('cognitoUnauthRoleArn'));
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