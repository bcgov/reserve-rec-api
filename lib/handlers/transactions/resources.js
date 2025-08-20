const lambda = require('aws-cdk-lib/aws-lambda');
const apigateway = require('aws-cdk-lib/aws-apigateway');
const iam = require('aws-cdk-lib/aws-iam');
const { NodejsFunction } = require("aws-cdk-lib/aws-lambda-nodejs");

function transactionsSetup(scope, props) {
  console.log('Transactions handlers setup...');

  // /transactions resource
  const transactionsResource = props.api.root.addResource('transactions');

  // /transactions/{clientTransactionId} resource (specific transaction)
  const transactionsByTransactionIdResource = transactionsResource.addResource('{clientTransactionId}');

  // GET /transactions
  const transactionsGet = new NodejsFunction(scope, 'TransactionsGet', {
    code: lambda.Code.fromAsset('lib/handlers/transactions'),
    handler: 'GET/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });
  transactionsResource.addMethod('GET', new apigateway.LambdaIntegration(transactionsGet));
  transactionsByTransactionIdResource.addMethod('GET', new apigateway.LambdaIntegration(transactionsGet));

  // POST /transactions
  const transactionsPost = new NodejsFunction(scope, 'TransactionsPost', {
    code: lambda.Code.fromAsset('lib/handlers/transactions'),
    handler: 'POST/index.handler',
    runtime: lambda.Runtime.NODEJS_20_X,
    environment: props.env,
    layers: props.layers,
  });

  transactionsResource.addMethod('POST', new apigateway.LambdaIntegration(transactionsPost));

  const dynamodbPolicy = new iam.PolicyStatement({
    actions: [
      'dynamodb:BatchGetItem',
      'dynamodb:BatchWriteItem',
      'dynamodb:PutItem',
      'dynamodb:GetItem',
      'dynamodb:Query',
      'dynamodb:Scan',
      'dynamodb:UpdateItem',
    ],
    resources: [props.mainTable.tableArn, `${props.mainTable.tableArn}/index/*`],
  });
  transactionsGet.addToRolePolicy(dynamodbPolicy);
  transactionsPost.addToRolePolicy(dynamodbPolicy);

  return {
    transactionsResource: transactionsResource,
    transactionsByTransactionIdResource: transactionsByTransactionIdResource,
    transactionsGet: transactionsGet,
    transactionsPost: transactionsPost,
  };

}

module.exports = {
  transactionsSetup,
};
