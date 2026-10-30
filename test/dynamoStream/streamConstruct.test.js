'use strict';

const { Template } = require('aws-cdk-lib/assertions');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => {
  const lambdaLib = require('aws-cdk-lib/aws-lambda');
  class NodejsFunction extends lambdaLib.Function {
    constructor(scope, id, { code, ...props }) {
      super(scope, id, { ...props, code: lambdaLib.Code.fromInline('exports.handler = async () => ({})') });
    }
  }
  return { NodejsFunction };
});

const { testStack } = require('../helpers/cdkConstruct');
const { DynamoStreamConstruct } = require('../../src/handlers/dynamoStream/constructs');

function withTable() {
  const stack = testStack();
  const table = new dynamodb.Table(stack, 'Ref', {
    partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
    stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
  });
  return { stack, table };
}

describe('DynamoStreamConstruct', () => {
  it('attaches the stream processor with retries and batch bisection', () => {
    const { stack, table } = withTable();
    new DynamoStreamConstruct(stack, 'refStream', { table, handlerPrefix: 'refDataStream' });
    const t = Template.fromStack(stack);
    t.hasResourceProperties('AWS::Lambda::Function', { Handler: 'refDataStream.handler', FunctionName: 'ReserveRecApi-test-refDataStream' });
    t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      StartingPosition: 'TRIM_HORIZON', BatchSize: 10, BisectBatchOnFunctionError: true, MaximumRetryAttempts: 3,
    });
  });

  it('leaves imported tables without a stream mapping', () => {
    const { stack, table } = withTable();
    new DynamoStreamConstruct(stack, 'refStream', { table, tablesCreatedByCDK: false });
    const t = Template.fromStack(stack);
    t.resourceCountIs('AWS::Lambda::EventSourceMapping', 0);
    t.hasResourceProperties('AWS::Lambda::Function', { Handler: 'DynamoStream.handler' });
  });

  it('requires a table', () => {
    expect(() => new DynamoStreamConstruct(testStack(), 'refStream', {})).toThrow('DynamoStreamConstruct requires a table property in props');
  });
});
