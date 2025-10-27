const { Construct } = require('constructs');
const { logger } = require('./utils');
const iam = require('aws-cdk-lib/aws-iam');
const lambda = require('aws-cdk-lib/aws-lambda');
const { NodejsFunction } = require('aws-cdk-lib/aws-lambda-nodejs');
const { Duration } = require('aws-cdk-lib');

const DEFAULT_NODE_RUNTIME = lambda.Runtime.NODEJS_20_X;
const DEFAULT_TIMEOUT_SECONDS = 10;

class LambdaConstruct extends Construct {
  constructor(scope, id, props) {
    const constructId = scope.createScopedId(id);
    super(scope, constructId, props);

    this.configuredEnvironment = props?.environment || {};
    this.id = id;
    this.stackId = scope.stackId;
    this.constructId = constructId;
    this.appScope = scope?.appScope;
    this.stackScope = scope;
    this.resources = props?.defaults?.resources || {};
    this.registry = new Map();
    this.defaultEnv = this.createDefaultEnvironmentVariables();

    this.api = props?.api;
    this.authorizer = props?.authorizer;
    this.layers = props?.layers || [];

    logger.debug(`LambdaConstruct: ${this.constructId} initialized`);

    this.createScopedId = scope.createScopedId;
  }

  createDefaultEnvironmentVariables() {
    return {
      REFERENCE_DATA_TABLE_NAME: this.appScope.resolveRefDataTableName(this),
      AUDIT_TABLE_NAME: this.appScope.resolveAuditTableName(this),
      OPENSEARCH_DOMAIN_ENDPOINT: this.appScope.resolveOpenSearchDomainEndpoint(this),
      OPENSEARCH_REFERENCE_DATA_INDEX_NAME: this.appScope.resolveOpenSearchReferenceDataIndexName(this),
    };
  }

  resolveEnvironment() {
    return { ...this.defaultEnv, ...this.configuredEnvironment };
  }

  resolveApi() {
    if (!this.api) {
      throw new Error(`LambdaConstruct: ${this.constructId} is missing required property "api"`);
    }
    return this.api;
  }

  resolveAuthorizer() {
    if (!this.authorizer) {
      throw new Error(`LambdaConstruct: ${this.constructId} is missing required property "authorizer"`);
    }
    return this.authorizer;
  }

  resolveLayers() {
    if (!this.layers || this.layers.length === 0) {
      throw new Error(`LambdaConstruct: ${this.constructId} has no layers configured`);
    }
    return this.layers;
  }

  getResourceId(resourceKey) {
    if (this.resources && this.resources[resourceKey] && this.resources[resourceKey].name) {
      return this.createScopedId(this.stackId, this.resources[resourceKey].name);
    }
    throw new Error(`LambdaConstruct: ${this.constructId} is missing resource key "${resourceKey}"`);
  }

  getReferenceDataTableArn() {
    if (this.registry.has('ReferenceDataTableArn')) {
      return this.registry.get('ReferenceDataTableArn');
    }
    const refDataTableArn = this.appScope.resolveRefDataTableArn(this);
    this.registry.set('ReferenceDataTableArn', refDataTableArn);
    return refDataTableArn;
  }

  // Grant basic read access to the reference data table
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

  // Grants read and write permissions to the reference data table
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

  // A simple method to generate a basic NodejsFunction Lambda
  // Not necessary for all use cases, but helps reduce boilerplate
  generateBasicLambdaFn(
    scope,
    functionKey,
    handlerPath,
    handlerName,
    props = {}
  ) {
    const functionId = this.getResourceId(functionKey);
    logger.debug(`Creating Basic Lambda Function: ${functionId}`);
    try {
      const fn = new NodejsFunction(scope, functionId, {
        runtime: props?.runtime || DEFAULT_NODE_RUNTIME,
        handler: handlerName,
        code: lambda.Code.fromAsset(handlerPath),
        layers: this.resolveLayers(),
        environment: this.resolveEnvironment(),
        description: props?.description || `Lambda function ${functionId} for the api: ${this.resolveApi()?.restApiName}`,
        functionName: functionId,
        timeout: props?.timeout || Duration.seconds(DEFAULT_TIMEOUT_SECONDS),
      });
      if (props?.basicRead) {
        this.grantBasicRefDataTableRead(fn);
      } else if (props?.basicReadWrite) {
        this.grantBasicRefDataTableReadWrite(fn);
      }
      return fn;
    } catch (error) {
      throw new Error(`Error creating Lambda Function: ${functionId} - ${error.message}`);
    }
  }

}


module.exports = {
  LambdaConstruct,
};