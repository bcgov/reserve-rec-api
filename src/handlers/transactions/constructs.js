const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");

const defaults = {
  resources: {
    transactionsGetFunction: {
      name: 'TransactionsGET',
    },
    transactionsPostFunction: {
      name: 'TransactionsPOST',
    },
    transactionsRefundsGetFunction: {
      name: 'TransactionsRefundsGET',
    },
    transactionsRefundsPostFunction: {
      name: 'TransactionsRefundsPOST',
    }
  }
};

class TransactionsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'index';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /transactions resource
    this.transactionsResource = this.resolveApi().root.addResource('transactions');

    // Add /transactions/{clientTransactionId} resource
    this.transactionsByTransactionIdResource = this.transactionsResource.addResource('{clientTransactionId}');

    // Add /transactions/{clientTransactionId}/refunds resource
    this.transactionsRefundsResource = this.transactionsByTransactionIdResource.addResource('refunds');

    // Add /transactions/{clientTransactionId}/refunds/{refundId} resource
    this.transactionsRefundsByRefundIdResource = this.transactionsRefundsResource.addResource('{refundId}');

    // Transactions GET Lambda Function
    this.transactionsGetFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsGetFunction',
      'src/handlers/transactions/GET',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // GET /transactions
    this.transactionsResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /transactions/{clientTransactionId}
    this.transactionsByTransactionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions POST Lambda Function
    this.transactionsPostFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsPostFunction',
      'src/handlers/transactions/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /transactions
    this.transactionsResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Refunds GET Lambda Function
    this.transactionsRefundsGetFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsRefundsGetFunction',
      'src/handlers/transactions/refunds/GET',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // GET /transactions/{clientTransactionId}/refunds
    this.transactionsRefundsResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsRefundsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /transactions/{clientTransactionId}/refunds/{refundId}
    this.transactionsRefundsByRefundIdResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsRefundsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Refunds POST Lambda Function
    this.transactionsRefundsPostFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsRefundsPostFunction',
      'src/handlers/transactions/refunds/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /transactions/{clientTransactionId}/refunds
    this.transactionsRefundsResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsRefundsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add SNS permissions to the refunds POST function
    if (props.refundRequestTopicArn) {
      const snsPolicy = new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [props.refundRequestTopicArn],
      });
      this.transactionsRefundsPostFunction.addToRolePolicy(snsPolicy);

      // Add KMS permissions if KMS key is provided
      if (props?.kmsKey) {
        this.transactionsRefundsPostFunction.addToRolePolicy(new iam.PolicyStatement({
          actions: [
            'kms:Decrypt',
            'kms:GenerateDataKey',
          ],
          resources: [props.kmsKey.keyArn],
        }));
      }
    }

    // Add permissions to all functions
    const functions = [
      this.transactionsGetFunction,
      this.transactionsPostFunction,
      this.transactionsRefundsGetFunction,
      this.transactionsRefundsPostFunction,
    ];

    for (const func of functions) {
      this.grantBasicTransDataTableReadWrite(func);
    }
  }
}

module.exports = {
  TransactionsConstruct,
};
