#!/usr/bin/env node
const cdk = require('aws-cdk-lib');
const { ReserveRecCdkStack } = require('../lib/reserve-rec-cdk-stack');

const app = new cdk.App();
new ReserveRecCdkStack(app, 'ReserveRecCdkStack', {
  env: {
    // AWS account variables
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,

    // Custom environment variables
    API_STAGE: process.env.API_STAGE || 'api',
    corsAllowOrigins: process.env.CORS_ALLOW_ORIGINS || 'http://localhost:4200,http://localhost:4300',
    azureClientId: process.env.AZURE_CLIENT_ID || 'azure-client-id',
    azureAppClientName: process.env.AZURE_APP_CLIENT_NAME || 'azure-app-client-name',
    azureProviderName: process.env.AZURE_PROVIDER_NAME || 'AzureIDIR',
    azureClientSecret: process.env.AZURE_CLIENT_SECRET || 'azure-app-secret',
    azureCallbackUrls: process.env.AZURE_CALLBACK_URLS || 'http://localhost:4300/callback',
    azureLogoutUrls: process.env.AZURE_LOGOUT_URLS || 'http://localhost:4300/logout',
    allowedOAuthFlows: process.env.AZURE_ALLOWED_OAUTH_FLOWS || 'ALLOW_USER_SRP_AUTH,ALLOW_CUSTOM_AUTH',
    azureIssuerUrl: process.env.AZURE_ISSUER_URL || 'azure-oidc-url',
    cmsApiUrl: process.env.CMS_API_URL || 'https://cms.bcparks.ca/api',
    DATA_REGISTER_URL: process.env.DATA_REGISTER_URL || 'https://data-register.bcparks.ca/api',
    domainName: process.env.DOMAIN_NAME || 'reserve-rec',
    DYNAMODB_ENDPOINT_URL: process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000',
    EBS_IOPS: process.env.EBS_IOPS || '3000',
    environmentName: process.env.ENVIRONMENT_NAME || 'dev',
    identityPoolName: process.env.IDENTITY_POOL_NAME || 'ReserveRecIdentity',
    instanceCount: process.env.INSTANCE_COUNT || '1',
    instanceType: process.env.INSTANCE_TYPE || 't3.small.search',
    IS_OFFLINE: process.env.IS_OFFLINE || 'false',
    jwks: process.env.JWKS || 'jwks',
    kmsKeyId: process.env.KMS_KEY_ID || 'arn:aws:kms:ca-central-1:637423314715:alias/aws/es',
    OPENSEARCH_DOMAIN_NAME: process.env.OPENSEARCH_DOMAIN_NAME || 'reserve-rec-os',
    OPENSEARCH_ADMIN_PASSWORD: process.env.OPENSEARCH_ADMIN_PASSWORD || 'admin',
    OPENSEARCH_DOMAIN_URL: process.env.OPENSEARCH_DOMAIN_URL || 'http://localhost:9200',
    opensearchMainIndex: process.env.OPENSEARCH_MAIN_INDEX || 'main-index',
    project: process.env.PROJECT || 'reserve-rec',
    stage: process.env.STAGE || 'api',
    AUDIT_TABLE_NAME: process.env.TABLE_NAME_AUDIT || 'reserve-rec-audit',
    TABLE_NAME: process.env.TABLE_NAME || 'reserve-rec-main',
    PUBSUB_TABLE_NAME: process.env.PUBSUB_TABLE_NAME || 'reserve-rec-pubsub',
    tantalisEndpointUrl: process.env.TANTALIS_ENDPOINT_URL || 'https://openmaps.gov.bc.ca/geo/pub/WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW/ows',
    SAML_IDP_ENTITY_ID: process.env.SAML_IDP_ENTITY_ID || 'saml-idp-entity-id',
    SAML_IDP_METADATA_CONTENT: process.env.SAML_IDP_METADATA_CONTENT || 'saml-idp-metadata-content',
    DATA_REGISTER_URL: process.env.DATA_REGISTER_URL || 'https://dev-data.bcparks.ca/api',
    S3_BUCKET_GEOSPATIAL: process.env.S3_BUCKET_GEOSPATIAL || 'reserve-rec-geospatial',

    // Public Cognito
    publicUserPoolName: process.env.PUBLIC_USER_POOL_NAME || 'public',
    publicUserPoolClientName: process.env.PUBLIC_USER_POOL_CLIENT_NAME || 'public-web-app',
    publicCognitoCallbackURLs: process.env.PUBLIC_COGNITO_CALLBACK_URLS || 'http://localhost:4200,http://localhost:4300',
  },
});
