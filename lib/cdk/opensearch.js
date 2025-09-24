/**
 *  Builds the OpenSearch resources for the ReserveRec CDK stack.
 */

const { CfnOutput } = require('aws-cdk-lib');
const { Aws, RemovalPolicy } = require('aws-cdk-lib');
const iam = require('aws-cdk-lib/aws-iam');
const opensearch = require('aws-cdk-lib/aws-opensearchservice');
const ssm = require('aws-cdk-lib/aws-ssm');

function opensearchSetup(scope, props) {
  console.log('Setting up OpenSearch resources...');

  // DYNAMODB STREAMS

  // Opensearch Role for Stream Processing

  const osMasterRoleDynamoDBPolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'dynamodb:GetItem',
      'dynamodb:DeleteItem',
      'dynamodb:PutItem',
      'dynamodb:Scan',
      'dynamodb:Query',
      'dynamodb:UpdateItem',
      'dynamodb:BatchWriteItem',
      'dynamodb:BatchGetItem',
      'dynamodb:DescribeTable',
      'dynamodb:ConditionCheckItem',
    ],
    resources: [
      props.auditTable.tableArn,
      props.mainTable.tableArn
    ],
  });

  const osMasterRoleOSPolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    actions: [
      'es:ESHttp*',
    ],
    resources: [`arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${props.env.OPENSEARCH_DOMAIN_NAME}/*`],
  });

  const osMasterRole = new iam.Role(scope, 'OSMasterRole', {
    assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    roleName: `ReserveRecOSMasterRole-${props.env.environmentName}`,
    description: 'Role for Lambda to access DynamoDB Streams and OpenSearch',
  });

  osMasterRole.addToPolicy(osMasterRoleDynamoDBPolicy);
  osMasterRole.addToPolicy(osMasterRoleOSPolicy);
  osMasterRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
  osMasterRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaDynamoDBExecutionRole'));
  osMasterRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'));

  // OpenSearch Domain

  const osAccessPolicy = new iam.PolicyStatement({
    effect: iam.Effect.ALLOW,
    principals: [new iam.AnyPrincipal()],
    actions: ['es:*'],
    resources: [`arn:aws:es:${Aws.REGION}:${Aws.ACCOUNT_ID}:domain/${props.env.OPENSEARCH_DOMAIN_NAME}/*`],
  });

  const opensearchDomain = new opensearch.Domain(scope, 'OpenSearchDomain', {
    domainName: props.env.OPENSEARCH_DOMAIN_NAME,
    accessPolicies: [osAccessPolicy],
    capacity: {
      dataNodes: 2,
      dataNodeInstanceType: 't3.medium.search',
      multiAzWithStandbyEnabled: false,
    },
    enforceHttps: true,
    nodeToNodeEncryption: true,
    encryptionAtRest: {
      enabled: true,
      kmsKey: props.env.KMS_KEY_ID,
    },
    version: opensearch.EngineVersion.openSearch('2.17'),
    enableVersionUpgrade: true,
    ebs: {
      enabled: true,
      volumeSize: 10,
      throughput: 125,
      volumeType: 'gp3',
      iops: parseInt(props.env.EBS_IOPS),
    },
    fineGrainedAccessControl: {
      masterUserArn: osMasterRole.roleArn,
      samlAuthenticationEnabled: true,
      samlAuthenticationOptions: {
        idpEntityId: ssm.StringParameter.valueForStringParameter(scope, 'OS_SAML_IDP_ENTITY_ID'),
        idpMetadataContent: ssm.StringParameter.valueForStringParameter(scope, 'OS_SAML_IDP_METADATA_CONTENT'),
        rolesKey: 'Roles',
      }
    },
    zoneAwareness: {
      enabled: false,
    },
    removalPolicy: RemovalPolicy.RETAIN, // Will orphan the domain when the stack is deleted rather than deleting it
  });

  // Outputs
  new CfnOutput(scope, `OpenSearchDomainEndpoint-${props.env.environmentName}`, {
    value: opensearchDomain.domainEndpoint,
    description: 'OpenSearch Domain Endpoint',
    exportName: `OpenSearchDomainEndpoint-${props.env.environmentName}`,
  });

  new CfnOutput(scope, `OpenSearchDomainArn-${props.env.environmentName}`, {
    value: opensearchDomain.domainArn,
    description: 'OpenSearch Domain ARN',
    exportName: `OpenSearchDomainArn-${props.env.environmentName}`,
  });

  return {
    opensearchDomain: opensearchDomain,
    osMasterRole: osMasterRole,
    osMasterRoleDynamoDBPolicy: osMasterRoleDynamoDBPolicy,
    osMasterRoleOSPolicy: osMasterRoleOSPolicy,
  };

}

module.exports = {
  opensearchSetup
};
