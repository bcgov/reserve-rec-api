const { Stack, CfnOutput } = require('aws-cdk-lib');
const { Function, Runtime, Code } = require('aws-cdk-lib/aws-lambda');
const { PolicyStatement, Effect } = require('aws-cdk-lib/aws-iam');

class TableManagerStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Lambda function for table management
    const tableManagerFunction = new Function(this, 'TableManagerFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromAsset('lib/handlers/tableManager'),
      environment: {
        REGION: 'ca-central-1',
        STACK_NAME: props.targetStackName || 'ReserveRecCdkStack'
      }
    });

    // Permissions for Dynamo operations
    tableManagerFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:DescribeTable',
        'dynamodb:CreateTable',
        'dynamodb:ListTables'
      ],
      resources: ['*']
    }));

    // Permissions for Parameter Store
    tableManagerFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'ssm:GetParameter',
        'ssm:PutParameter',
        'ssm:DeleteParameter'
      ],
      resources: [`arn:aws:ssm:ca-central-1:${this.account}:parameter/reserve-rec/*`]
    }));

    // Permissions for CloudFormation (import operations)
    tableManagerFunction.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'cloudformation:DescribeStacks',
        'cloudformation:DescribeStackResources',
        'cloudformation:ImportStackResources'
      ],
      resources: ['*']
    }));

    // Output the function ARN for manual invocation
    new CfnOutput(this, 'TableManagerFunctionArn', {
      value: tableManagerFunction.functionArn,
      description: 'ARN of the Table Manager Lambda function',
      exportName: 'TableManagerFunctionArn'
    });

    new CfnOutput(this, 'TableManagerFunctionName', {
      value: tableManagerFunction.functionName,
      description: 'Name of the Table Manager Lambda function',
      exportName: 'TableManagerFunctionName'
    });
  }
}

module.exports = { TableManagerStack };
