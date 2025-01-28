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
    azureAppId: process.env.AZURE_APP_ID || 'azure-app-id',
    azureAppSecret: process.env.AZURE_APP_SECRET || 'azure-app-secret',
    azureOIDCUrl: process.env.AZURE_OIDC_URL || 'azure-oidc-url',
    cmsApiUrl: process.env.CMS_API_URL || 'https://cms.bcparks.ca/api',
    cognitoCallbackUrls: process.env.COGNITO_CALLBACK_URLS || 'http://localhost:4200,http://localhost:4300',
    cognitoUserPoolClientName: process.env.COGNITO_USER_POOL_CLIENT_NAME || 'public-web-app',
    cognitoUserPoolName: process.env.COGNITO_USER_POOL_NAME || 'public',
    dataRegisterApiKey: process.env.DATA_REGISTER_API_KEY || 'dev-api',
    dataRegisterAoUrl: process.env.DATA_REGISTER_AO_URL || 'https://dev-data.bcparks.ca/api',
    domainName: process.env.DOMAIN_NAME || 'reserve-rec',
    DYNAMODB_ENDPOINT_URL: process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000',
    ebsIops: process.env.EBS_IOPS || '3000',
    environmentName: process.env.ENVIRONMENT_NAME || 'dev',
    identityPoolName: process.env.IDENTITY_POOL_NAME || 'ReserveRecIdentity',
    instanceCount: process.env.INSTANCE_COUNT || '1',
    instanceType: process.env.INSTANCE_TYPE || 't3.small.search',
    jwks: process.env.JWKS || 'jwks',
    kmsKeyId: process.env.KMS_KEY_ID || 'arn:aws:kms:ca-central-1:637423314715:alias/aws/es',
    opensearchEndpointUrl: process.env.OPENSEARCH_ENDPOINT_URL || 'http://localhost:9200',
    opensearchMainIndex: process.env.OPENSEARCH_MAIN_INDEX || 'main-index',
    project: process.env.PROJECT || 'reserve-rec',
    stage: process.env.STAGE || 'api',
    AUDIT_TABLE_NAME: process.env.TABLE_NAME_AUDIT || 'reserve-rec-audit',
    TABLE_NAME: process.env.TABLE_NAME || 'reserve-rec-main',
    PUBSUB_TABLE_NAME: process.env.PUBSUB_TABLE_NAME || 'reserve-rec-pubsub',
    tantalisEndpointUrl: process.env.TANTALIS_ENDPOINT_URL || 'https://openmaps.gov.bc.ca/geo/pub/WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW/ows',
  },
});
