const { RemovalPolicy, Duration, CfnJson } = require('aws-cdk-lib');
const { logger } = require("../helpers/utils");
const cognito = require('aws-cdk-lib/aws-cognito');
const { StackPrimer } = require("../helpers/stack-primer");
const { BaseStack } = require('../helpers/base-stack');
const iam = require('aws-cdk-lib/aws-iam');
const publicRoles = require('./public-roles.json');

// Load CSS file for Cognito User Pool UI customization
const fs = require('fs');
const path = require('path');
const cssPath = path.join(__dirname, 'cognito-ui-styling.css');
const userPoolStyling = fs.readFileSync(cssPath, 'utf8');

const defaults = {
  description: 'Public Identity stack managing Cognito User Pool, Identity Pool, OIDC providers, and related IAM roles for public access to the Reserve Recreation APIs.',
  constructs: {
    cognitoAuthRole: {
      name: 'CognitoAuthRole',
    },
    cognitoUnauthRole: {
      name: 'CognitoUnauthRole',
    },
    publicIdentityPool: {
      name: 'PublicIdentityPool',
    },
    publicUserPoolClient: {
      name: 'PublicUserPoolClient',
    },
    publicUserPoolDomain: {
      name: 'UserPoolDomain',
    },
    publicUserPool: {
      name: 'PublicUserPool',
    },
    publicUserGroup: {
      name: 'PublicUserGroup',
    },
  },
  config: {
    publicCognitoCallbackUrls: [
      "http://localhost:4200"
    ],
    publicCognitoLogoutUrls: [
      "http://localhost:4200/logout"
    ],
    poolDeletionProtection: false,
    domainPrefix: "reserve-rec-public-identity",
    logLevel: process.env.LOG_LEVEL || 'info',
    customAttributes: {
      licensePlate: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      mobilePhone: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      postalCode: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      province: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      pwUpdate: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      secondaryNumber: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      streetAddress: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
      vehicleRegLocale: {
        minLen: 0,
        maxLen: 2048,
        mutable: true,
      },
    },
  },
};

async function createPublicIdentityStack(scope, stackKey) {
  try {
    const primer = new StackPrimer(scope, stackKey, defaults);
    await primer.prime();
    return new PublicIdentityStack(scope, primer);
  } catch (error) {
    throw new Error(`Error creating Public Identity Stack: ${error}`);
  }
}

function createCustomAttributes(config) {
  const attributes = {};
  for (const [attrName, attrConfig] of Object.entries(config.customAttributes)) {
    attributes[attrName] = new cognito.StringAttribute({
      minLen: attrConfig.minLen,
      maxLen: attrConfig.maxLen,
      mutable: attrConfig.mutable,
    });
  }
  return attributes;
}

class PublicIdentityStack extends BaseStack {
  constructor(scope, primer) {
    super(scope, primer, defaults);

    logger.info(`Creating Public Identity Stack: ${this.stackId}`);

    // Create a public Cognito User Pool
    this.publicUserPool = new cognito.UserPool(this, this.getConstructId('publicUserPool'), {
      userPoolName: this.getConstructId('publicUserPool'),
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userVerification: {
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      selfSignUpEnabled: true,
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      customAttributes: createCustomAttributes(this.getConfigValue('customAttributes')),
      userAttributeUpdateSettings: {
        attributesRequireVerificationBeforeUpdate: ['email'],
      },
      deletionProtection: this.getConfigValue('poolDeletionProtection') ? true : false,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Set up User Pool Domain for public users
    this.publicUserPoolDomain = new cognito.UserPoolDomain(this, this.getConstructId('publicUserPoolDomain'), {
      userPool: this.publicUserPool,
      cognitoDomain: {
        domainPrefix: this.createDomainPrefix()
      }
    });

    // Setup Cognito User Pool Client for public users
    this.publicUserPoolClient = new cognito.UserPoolClient(this, this.getConstructId('publicUserPoolClient'), {
      userPool: this.publicUserPool,
      userPoolClientName: this.getConstructId('publicUserPoolClient'),
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      generateSecret: false,
      selfSignUpEnabled: true,
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.COGNITO_ADMIN,
        ],
        callbackUrls: this.getConfigValue('publicCognitoCallbackUrls'),
        logoutUrls: this.getConfigValue('publicCognitoLogoutUrls'),
      },
      accessTokenValidity: Duration.days(1),
      idTokenValidity: Duration.days(1),
      refreshTokenValidity: Duration.days(30),
    });

    //create an identity pool
    this.publicIdentityPool = new cognito.CfnIdentityPool(this, this.getConstructId('publicIdentityPool'), {
      identityPoolName: this.getConstructId('publicIdentityPool'),
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: this.publicUserPoolClient.userPoolClientId,
          providerName: this.publicUserPool.userPoolProviderName
        }
      ],
    });

    // Define the authenticated role
    this.cognitoAuthRole = new iam.Role(this, this.getConstructId('cognitoAuthRole'), {
      roleName: this.getConstructId('cognitoAuthRole'),
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          'StringEquals': { 'cognito-identity.amazonaws.com:aud': this.publicIdentityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        // TODO: Change this to custom roles when we know what public users can do
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoReadOnly')
      ]
    });

    // Define the unauthenticated role
    this.cognitoUnauthRole = new iam.Role(this, this.getConstructId('cognitoUnauthRole'), {
      roleName: this.getConstructId('cognitoUnauthRole'),
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          'StringEquals': { 'cognito-identity.amazonaws.com:aud': this.publicIdentityPool.ref },
          'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      managedPolicies: [
        // TODO: Change this to custom roles when we know what public users can do
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoUnAuthedIdentitiesSessionPolicy')
      ]
    });


    // Create public roles and user groups
    this.publicRoleMappings = {};
    let roleMappingRules = [];
    for (const [roleKey, roleConfig] of Object.entries(publicRoles)) {
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
            'StringEquals': { 'cognito-identity.amazonaws.com:aud': this.publicIdentityPool.ref },
            'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'authenticated' }
          },
          'sts:AssumeRoleWithWebIdentity'
        )
      });

      // Create Cognito User Group
      const groupName = primer.createConstructId({ name: roleConfig.groupName });
      const userGroup = new cognito.CfnUserPoolGroup(this, groupName, {
        groupName: groupName,
        userPoolId: this.publicUserPool.userPoolId,
        description: roleConfig.description,
        role: iamRole,
      });

      roleMappingRules.push({
        Claim: 'cognito:groups',
        MatchType: 'Contains',
        Value: groupName,
        RoleArn: iamRole.roleArn
      });

      scope.addGroupWithRole(roleKey, userGroup, iamRole);

      // Export Role Reference
      this.exportReference(this, `${roleKey}RoleArn`, iamRole.roleArn, `ARN of the ${roleKey} role in ${this.stackId}`);
    }

    // Create Role Mapping for Identity Pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'PublicIdentityPoolRoleAttachment', {
      identityPoolId: this.publicIdentityPool.ref,
      roles: {
        authenticated: this.cognitoAuthRole.roleArn,
        unauthenticated: this.cognitoUnauthRole.roleArn
      },
      roleMappings: this.publicRoleMappings
    });

    this.publicRoleMappingJson = new CfnJson(this, 'PublicRoleMappingJson', {
      value: this.publicRoleMappings
    });

    // Setup UI customization for the public user pool
    new cognito.CfnUserPoolUICustomizationAttachment(this, 'PublicCognitoUICustomization', {
      userPoolId: this.publicUserPool.userPoolId,
      clientId: this.publicUserPoolClient.userPoolClientId,
      css: userPoolStyling
    });

    // Export References

    // Public User Pool ID
    this.exportReference(this, 'publicUserPoolId', this.getPublicUserPoolId(), `ID of the Public Cognito User Pool in ${this.stackId}`);

    // Public User Pool Client ID
    this.exportReference(this, 'publicUserPoolClientId', this.getPublicUserPoolClientId(), `ID of the Public Cognito User Pool Client in ${this.stackId}`);

    // Public Identity Pool ID
    this.exportReference(this, 'publicIdentityPoolId', this.getPublicIdentityPoolId(), `ID of the Public Cognito Identity Pool in ${this.stackId}`);

    // Authenticated Cognito Role ARN
    this.exportReference(this, 'cognitoAuthRoleArn', this.cognitoAuthRole.roleArn, `ARN of the Cognito Authenticated Role in ${this.stackId}`);

    // Unauthenticated Cognito Role ARN
    this.exportReference(this, 'cognitoUnauthRoleArn', this.cognitoUnauthRole.roleArn, `ARN of the Cognito Unauthenticated Role in ${this.stackId}`);

    // Bind resolve functions to scope for other stacks to consume
    scope.resolvePublicUserPoolId = this.resolvePublicUserPoolId.bind(this);
    scope.resolvePublicUserPoolClientId = this.resolvePublicUserPoolClientId.bind(this);
    scope.resolvePublicIdentityPoolId = this.resolvePublicIdentityPoolId.bind(this);
    scope.resolvePublicAuthenticatedCognitoRoleArn = this.resolvePublicAuthenticatedCognitoRoleArn.bind(this);
    scope.resolvePublicUnauthenticatedCognitoRoleArn = this.resolvePublicUnauthenticatedCognitoRoleArn.bind(this);

  }

  getPublicUserPool() {
    return this.publicUserPool;
  }

  getPublicUserPoolId() {
    return this.publicUserPool.userPoolId;
  }

  getPublicUserPoolClientId() {
    return this.publicUserPoolClient.userPoolClientId;
  }

  getPublicCognitoDomain() {
    return this.publicUserPoolDomain.domainName;
  }

  createDomainPrefix() {
    const prefix = this.getConfigValue('domainPrefix');
    return `${prefix}-${this.getDeploymentName()}`.toLowerCase();
  }

  getPublicIdentityPoolId() {
    return this.publicIdentityPool.ref;
  }

  resolvePublicUserPoolId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicUserPoolId'));
  }

  resolvePublicUserPoolClientId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicUserPoolClientId'));
  }

  resolvePublicIdentityPoolId(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('publicIdentityPoolId'));
  }

  resolvePublicAuthenticatedCognitoRoleArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('cognitoAuthRoleArn'));
  }

  resolvePublicUnauthenticatedCognitoRoleArn(consumerScope) {
    return this.resolveReference(consumerScope, this.getExportSSMPath('cognitoUnauthRoleArn'));
  }

}

module.exports = {
  createPublicIdentityStack,
};
