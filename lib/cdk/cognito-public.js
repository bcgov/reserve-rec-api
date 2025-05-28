const cdk = require('aws-cdk-lib');
const cognito = require('aws-cdk-lib/aws-cognito');
const iam = require('aws-cdk-lib/aws-iam');

function cognitoPublicSetup(scope, props) {
    console.log('Setting up Cognito Public...');

    // Setup Cognito User Pool for public users
    const publicUserPool = new cognito.UserPool(scope, 'PublicUserPool', {
        accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
        autoVerify: { email: true },
        userVerification: {
            emailStyle: cognito.VerificationEmailStyle.CODE,
        },
        standardAttributes: {
            email: {
                required: true,
                mutable: true,
            },
            givenName: {
                required: true,
                mutable: true,
            },
            familyName: {
                required: true,
                mutable: true,
            },
        },
        userPoolName: props.env.publicUserPoolName,
        userAttributeUpdateSettings: {
            attributesRequireVerificationBeforeUpdate: ['email'],
        },
        customAttributes: {
            'custom:city': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:country': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:homeAddress': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:homePhone': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:licensePlate': new cognito.StringAttribute({ minLen: 1, maxLen: 14, mutable: true }),
            'custom:mobilePhone': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:postalCode': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:province': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:pwUpdate': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
            'custom:secondaryNumber': new cognito.StringAttribute({ maxLen: 2048, mutable: true }),
        }
    });

    // Set up User Pool Domain for public users
    const userPoolDomain = new cognito.UserPoolDomain(scope, 'PublicUserPoolDomain', {
        cognitoDomain: {
            domainPrefix: `${props.env.project}-public-${props.env.environmentName}`
        },
        userPool: publicUserPool
    });

    // Setup Cognito User Pool Client for public users
    const publicUserPoolClient = new cognito.UserPoolClient(scope, 'PublicUserPoolClient', {
        userPool: publicUserPool,
        userPoolClientName: props.env.publicUserPoolClientName,
        supportedIdentityProviders: [
            cognito.UserPoolClientIdentityProvider.COGNITO,
        ],
        generateSecret: false,
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
            callbackUrls: props.env.publicCognitoCallbackURLs.split(','),
            logoutUrls: props.env.publicCognitoCallbackURLs.split(','),
        },
        accessTokenValidity: cdk.Duration.days(1),
        idTokenValidity: cdk.Duration.days(1),
        refreshTokenValidity: cdk.Duration.days(30),
    });



    // Define the authenticated role
    const publicAuthenticatedRole = new iam.Role(scope, 'PublicCognitoAuthenticatedRole', {
        assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
                'StringEquals': { 'cognito-identity.amazonaws.com:aud': publicUserPool.userPoolId },
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
    const publicUnauthenticatedRole = new iam.Role(scope, 'PublicCognitoUnauthenticatedRole', {
        assumedBy: new iam.FederatedPrincipal(
            'cognito-identity.amazonaws.com',
            {
                'StringEquals': { 'cognito-identity.amazonaws.com:aud': publicUserPool.userPoolId },
                'ForAnyValue:StringLike': { 'cognito-identity.amazonaws.com:amr': 'unauthenticated' }
            },
            'sts:AssumeRoleWithWebIdentity'
        ),
        managedPolicies: [
            // TODO: Change this to custom roles when we know what public users can do
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonCognitoUnAuthedIdentitiesSessionPolicy')
        ]
    });

    // Create an identity pool
    const publicIdentityPool = new cognito.CfnIdentityPool(scope, 'PublicIdentityPool', {
        allowUnauthenticatedIdentities: false,
        cognitoIdentityProviders: [
            {
                clientId: publicUserPoolClient.userPoolClientId,
                providerName: publicUserPool.userPoolProviderName
            }
        ],
    });

    // Attach roles to the identity pool
    new cognito.CfnIdentityPoolRoleAttachment(scope, 'PublicIdentityPoolRoleAttachment', {
        identityPoolId: publicIdentityPool.ref,
        roles: {
            authenticated: publicAuthenticatedRole.roleArn,
            unauthenticated: publicUnauthenticatedRole.roleArn
        }
    });

    // Set up UI customization for the User Pool
    new cognito.CfnUserPoolUICustomizationAttachment(scope, 'PublicCognitoUICustomization', {
        userPoolId: publicUserPool.userPoolId,
        clientId: publicUserPoolClient.userPoolClientId,
        css: `.banner-customizable {
            background-color: #013366;
            padding: 2em 0;
            border-bottom: 2px solid;
            border-color: #FCBA19;
            }
            .background-customizable {
            background-color: white;
            }
            .submitButton-customizable {
            background-color: #013366;
            }
            .submitButton-customizable:hover {
            background-color: #1E5189;
            }
            .inputField-customizable {
            border-color: white;
            }
            .inputField-customizable:focus {
            border-color: #EDEBE9;
            }
            .logo-customizable {
            max-width: 24rem;
            }`,
    });

    // Outputs
    new cdk.CfnOutput(scope, 'PublicUserPoolId', {
        value: publicUserPool.userPoolId,
        description: 'Public User Pool Id Reference',
        exportName: 'PublicUserPoolId',
    });

    new cdk.CfnOutput(scope, 'PublicUserPoolClientId', {
        value: publicUserPoolClient.userPoolClientId,
        description: 'Public User Pool Client Id Reference',
        exportName: 'PublicUserPoolClientId',
    });

    new cdk.CfnOutput(scope, 'PublicIdentityPoolId', {
        value: publicIdentityPool.ref,
        description: 'Public Identity Pool Id Reference',
        exportName: 'PublicIdentityPoolId',
    });

    new cdk.CfnOutput(scope, 'PublicUserPoolDomainUrl', {
        value: `https://${userPoolDomain.domainName}.auth.${props.env.region}.amazoncognito.com`,
        description: 'Public User Pool Domain Reference',
        exportName: 'PublicUserPoolDomainUrl',
    });

}

module.exports = {
    cognitoPublicSetup
};
