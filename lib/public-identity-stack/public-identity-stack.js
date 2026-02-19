const { RemovalPolicy, Duration, CfnJson } = require('aws-cdk-lib');
const { logger } = require("../helpers/utils");
const cognito = require('aws-cdk-lib/aws-cognito');
const lambda = require('aws-cdk-lib/aws-lambda');
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
    bcscOIDCProvider: {
      name: 'BCSCOIDCProvider',
    },
    newUserRegisterFunction: {
      name: 'NewUserRegisterFunction',
    },
  },
  secrets: {
    bcscClientSecret: {
      name: "bcscClientSecret"
    }
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
    bcscClientId: "bcsc-client-id",
    bcscIssuerUrl: "https://idtest.gov.bc.ca/oauth2",
    bcscAuthorizationEndpoint: "https://idtest.gov.bc.ca/oauth2/login/oidc/authorize",
    bcscTokenEndpoint: "https://idtest.gov.bc.ca/oauth2/token",
    bcscUserInfoEndpoint: "https://dpda9unosgd76.cloudfront.net/api/bcsc/userinfo/dev",
    bcscJwksUri: "https://idtest.gov.bc.ca/oauth2/jwks",
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

function createCustomAttributes(customAttributes) {
  const attributes = {};
  // Handle empty or undefined customAttributes
  if (!customAttributes || Object.keys(customAttributes).length === 0) {
    return attributes;
  }
  for (const [attrName, attrConfig] of Object.entries(customAttributes)) {
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

    // Import mode: If skipCreation override is set, import dev's identity resources instead of creating new ones
    // This is used for sandbox environments to share dev's public user pool and identity pool
    if (this.overrides?.skipCreation === true) {
      logger.info('Import mode enabled: Using existing public identity resources from override values');
      
      // Validate required override values
      const requiredOverrides = [
        'publicUserPoolId',
        'publicUserPoolClientId',
        'publicIdentityPoolId',
        'cognitoAuthRoleArn',
        'cognitoUnauthRoleArn'
      ];
      
      const missingOverrides = requiredOverrides.filter(key => !this.overrides[key]);
      if (missingOverrides.length > 0) {
        throw new Error(`Import mode requires these override values: ${missingOverrides.join(', ')}`);
      }

      // Export override values to sandbox's SSM paths (so downstream stacks can resolve them)
      this.exportReference(this, 'publicUserPoolId', this.overrides.publicUserPoolId, `ID of the Public Cognito User Pool in ${this.stackId} (imported)`);
      this.exportReference(this, 'publicUserPoolClientId', this.overrides.publicUserPoolClientId, `ID of the Public Cognito User Pool Client in ${this.stackId} (imported)`);
      this.exportReference(this, 'publicIdentityPoolId', this.overrides.publicIdentityPoolId, `ID of the Public Cognito Identity Pool in ${this.stackId} (imported)`);
      this.exportReference(this, 'cognitoAuthRoleArn', this.overrides.cognitoAuthRoleArn, `ARN of the Cognito Authenticated Role in ${this.stackId} (imported)`);
      this.exportReference(this, 'cognitoUnauthRoleArn', this.overrides.cognitoUnauthRoleArn, `ARN of the Cognito Unauthenticated Role in ${this.stackId} (imported)`);

      // Export role ARN if provided
      if (this.overrides.publicRoleArn) {
        this.exportReference(this, 'publicRoleArn', this.overrides.publicRoleArn, `ARN of the public role in ${this.stackId} (imported)`);
      }

      // Bind resolve functions to scope for other stacks to consume
      scope.resolvePublicUserPoolId = this.resolvePublicUserPoolId.bind(this);
      scope.resolvePublicUserPoolClientId = this.resolvePublicUserPoolClientId.bind(this);
      scope.resolvePublicIdentityPoolId = this.resolvePublicIdentityPoolId.bind(this);
      scope.resolvePublicAuthenticatedCognitoRoleArn = this.resolvePublicAuthenticatedCognitoRoleArn.bind(this);
      scope.resolvePublicUnauthenticatedCognitoRoleArn = this.resolvePublicUnauthenticatedCognitoRoleArn.bind(this);

      logger.info('Import mode: Public Identity Stack configured with imported resources');
      return; // Skip resource creation
    }

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
      deletionProtection: this.isSandbox() ? false : (this.getConfigValue('poolDeletionProtection') ? true : false),
      removalPolicy: RemovalPolicy.DESTROY
    });

    // POST_CONFIRMATION trigger - write new users to DynamoDB
    const baseLayer = this.resolve('baseLayer');
    const awsUtilsLayer = this.resolve('awsUtilsLayer');
    const transDataTableName = this.resolve('transactionalDataTableName');
    const transDataTableArn = this.resolve('transactionalDataTableArn');

    this.newUserRegisterFunction = new lambda.Function(this, this.getConstructId('newUserRegisterFunction'), {
      functionName: this.getConstructId('newUserRegisterFunction'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_18_X,
      code: lambda.Code.fromAsset('lib/handlers/cognitoTriggers/postConfirmation'),
      timeout: Duration.seconds(10),
      layers: [
        baseLayer,
        awsUtilsLayer
      ],
      environment: {
        TRANSACTIONAL_DATA_TABLE_NAME: transDataTableName,
        LOG_LEVEL: this.getConfigValue('logLevel')
      },
    });

    // Grant DynamoDB permissions to POST_CONFIRMATION trigger
    this.newUserRegisterFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ],
      resources: [transDataTableArn]
    }));

    // Attach POST_CONFIRMATION trigger to User Pool
    this.publicUserPool.addTrigger(
      cognito.UserPoolOperation.POST_CONFIRMATION,
      this.newUserRegisterFunction
    );

    // Set up User Pool Domain for public users
    this.publicUserPoolDomain = new cognito.UserPoolDomain(this, this.getConstructId('publicUserPoolDomain'), {
      userPool: this.publicUserPool,
      cognitoDomain: {
        domainPrefix: this.createDomainPrefix()
      }
    });

    // Create BCSC OIDC provider
    this.bcscOIDCProvider = new cognito.UserPoolIdentityProviderOidc(this, this.getConstructId('bcscOIDCProvider'), {
      userPool: this.publicUserPool,
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
      scopes: ['openid', 'profile', 'email', 'address'],
      attributeMapping: {
        email: cognito.ProviderAttribute.other("email"),
        givenName: cognito.ProviderAttribute.other("given_name"),
        familyName: cognito.ProviderAttribute.other("family_name"),
      }
    });

    // Setup Cognito User Pool Client for public users
    this.publicUserPoolClient = new cognito.UserPoolClient(this, this.getConstructId('publicUserPoolClient'), {
      userPool: this.publicUserPool,
      userPoolClientName: this.getConstructId('publicUserPoolClient'),
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.custom('BCSC'),
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

    // Add dependency to ensure BCSC provider exists before client
    this.publicUserPoolClient.node.addDependency(this.bcscOIDCProvider);

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
