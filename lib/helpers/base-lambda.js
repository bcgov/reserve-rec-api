const { Construct } = require('constructs');
const { logger } = require('./utils');
const iam = require('aws-cdk-lib/aws-iam');

class LambdaConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    this.configuredEnvironment = props?.environment || {};
    this.constructId = constructId;
    this.appScope = scope?.appScope;
    this.stackScope = scope;
    this.registry = new Map();
    this.defaultEnv = this.createDefaultEnvironmentVariables();

    this.api = props?.api;

    logger.debug(`LambdaConstruct: ${this.constructId} initialized`);

  }

  createDefaultEnvironmentVariables() {
    return {
      REFERENCE_DATA_TABLE_NAME: this.appScope.resolveRefDataTableName(this),
      AUDIT_TABLE_NAME: this.appScope.resolveAuditTableName(this),
      OPENSEARCH_DOMAIN_ENDPOINT: this.appScope.resolveOpenSearchDomainEndpoint(this),
      OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.appScope.resolveOpenSearchReferenceDataIndexName(this),
    }
  }

  resolveEnvironment() {
    return { ...this.defaultEnv, ...this.configuredEnvironment  };
  }

  getReferenceDataTableArn() {
    if (this.registry.has('ReferenceDataTableArn')) {
      return this.registry.get('ReferenceDataTableArn');
    }
    const refDataTableArn = this.appScope.resolveRefDataTableArn(this);
    this.registry.set('ReferenceDataTableArn', refDataTableArn);
    return refDataTableArn;
  }

  grantBasicRefDataTableRead(lambdaFunction) {
    const refDataTableArn = this.getReferenceDataTableArn();
    const readPolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchGetItem',
      ],
      resources: [refDataTableArn, `${refDataTableArn}/index/*`],
    });
    lambdaFunction.addToRolePolicy(readPolicy);
  }

  grantBasicRefDataTableReadWrite(lambdaFunction) {
    const refDataTableArn = this.getReferenceDataTableArn();
    const readWritePolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:BatchGetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:BatchWriteItem',
      ],
      resources: [refDataTableArn, `${refDataTableArn}/index/*`],
    });
    lambdaFunction.addToRolePolicy(readWritePolicy);
  }

}

module.exports = {
  LambdaConstruct,
};