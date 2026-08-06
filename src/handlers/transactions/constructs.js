const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");
const { Stack } = require("aws-cdk-lib");

const defaults = {
  resources: {
    transactionsAdminGetFunction: {
      name: 'TransAdminGET',
    },
    transactionsAdminPostFunction: {
      name: 'TransAdminPOST',
    },
    transactionsAdminRefundsGetFunction: {
      name: 'TransAdminRefGET',
    },
    transactionsAdminRefundsPostFunction: {
      name: 'TransAdminRefPOST',
    },
    transactionsPublicGetFunction: {
      name: 'TransPubGET',
    },
    transactionsPublicPostFunction: {
      name: 'TransPubPOST',
    },
    transactionsPublicRefundsGetFunction: {
      name: 'TransPubRefGET',
    },
    transactionsPublicRefundsPostFunction: {
      name: 'TransPubRefPOST',
    }
  }
};

class AdminTransactionsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'index';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /transactions resource
    this.transactionsResource = this.resolveApi().root.addResource('transactions');

    // Add /transactions/admin resource
    this.transactionsAdminResource = this.transactionsResource.addResource('admin');

    // Add /transactions/admin/{bookingId} resource
    this.transactionsByTransactionIdResource = this.transactionsAdminResource.addResource('{bookingId}');

    // Add /transactions/admin/{bookingId}/refunds resource
    this.transactionsRefundsResource = this.transactionsByTransactionIdResource.addResource('refunds');

    // Add /transactions/admin/{bookingId}/refunds/{refundId} resource
    this.transactionsRefundsByRefundIdResource = this.transactionsRefundsResource.addResource('{refundId}');

    // Add CORS preflight for transactions
    this.addCorsPreflightForResources([
      this.transactionsResource,
      this.transactionsAdminResource,
      this.transactionsByTransactionIdResource,
      this.transactionsRefundsResource,
      this.transactionsRefundsByRefundIdResource
    ]);

    // Transactions GET Lambda Function
    this.transactionsAdminGetFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsAdminGetFunction',
      'src/handlers/transactions/_bookingId/GET',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // GET /transactions
    this.transactionsAdminResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsAdminGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /transactions/{bookingId}
    this.transactionsByTransactionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsAdminGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions POST Lambda Function
    this.transactionsAdminPostFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsAdminPostFunction',
      'src/handlers/transactions/_bookingId/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /transactions
    this.transactionsAdminResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsAdminPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Refunds GET Lambda Function
    this.transactionsAdminRefundsGetFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsAdminRefundsGetFunction',
      'src/handlers/transactions/_bookingId/refunds/GET',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // GET /transactions/{bookingId}/refunds
    this.transactionsRefundsResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsAdminRefundsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /transactions/{bookingId}/refunds/{refundId}
    this.transactionsRefundsByRefundIdResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsAdminRefundsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Refunds POST Lambda Function
    this.transactionsAdminRefundsPostFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsAdminRefundsPostFunction',
      'src/handlers/transactions/_bookingId/refunds/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /transactions/{bookingId}/refunds
    this.transactionsRefundsResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsAdminRefundsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add SNS permissions to the refunds POST function
    if (props.refundRequestTopicArn) {
      const snsPolicy = new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [props.refundRequestTopicArn],
      });
      this.transactionsAdminRefundsPostFunction.addToRolePolicy(snsPolicy);

      // Add KMS permissions if KMS key is provided
      if (props?.kmsKey) {
        this.transactionsAdminRefundsPostFunction.addToRolePolicy(new iam.PolicyStatement({
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
      this.transactionsAdminGetFunction,
      this.transactionsAdminPostFunction,
      this.transactionsAdminRefundsGetFunction,
      this.transactionsAdminRefundsPostFunction,
    ];

    // Grant basic read and writes to Transaction table
    for (const func of functions) {
      this.grantBasicTransDataTableReadWrite(func);
    }
    
    // Grant basic writes to Audit table (admin only)
    for (const func of functions) {
      this.grantAuditTableWrite(func);
    }

    const paymentApiSecret = props.environment?.PAYMENTS_API_SECRET
    const merchantIdSecret = props.environment?.MERCHANT_ID_SECRET
    const hashKeySecret = props.environment?.HASH_KEY_SECRET

    // Grant read permissions for all transaction secrets to the POST/Refund functions
    if (props.environment && paymentApiSecret && merchantIdSecret && hashKeySecret) {
      const stack = Stack.of(this);

      const paymentsApiArnPattern = `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${paymentApiSecret}*`;
      const merchantIdArnPattern = `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${merchantIdSecret}*`;
      const hashKeyArnPattern = `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${hashKeySecret}*`;

      const functionsThatNeedSecret = [
        this.transactionsAdminPostFunction,
        this.transactionsAdminRefundsPostFunction,
      ];

      for (const func of functionsThatNeedSecret) {
        func.addToRolePolicy(new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [paymentsApiArnPattern, merchantIdArnPattern, hashKeyArnPattern],
        }));
      }
    }
  }
}

class PublicTransactionsConstruct extends LambdaConstruct {
  constructor(scope, id, props) {
    super(scope, id, {
      ...props,
      defaults: defaults
    });

    const handlerPrefix = props?.handlerPrefix || 'index';
    const handlerName = `${handlerPrefix}.handler`;

    // Add /transactions resource
    this.transactionsResource = this.resolveApi().root.addResource('transactions');

    // Add /transactions/{bookingId} resource
    this.transactionsByTransactionIdResource = this.transactionsResource.addResource('{bookingId}');

    // Add /transactions/{bookingId}/refunds resource
    this.transactionsRefundsResource = this.transactionsByTransactionIdResource.addResource('refunds');

    // Add /transactions/{bookingId}/refunds/{refundId} resource
    this.transactionsRefundsByRefundIdResource = this.transactionsRefundsResource.addResource('{refundId}');

    // Add CORS preflight for transactions
    this.addCorsPreflightForResources([
      this.transactionsResource,
      this.transactionsByTransactionIdResource,
      this.transactionsRefundsResource,
      this.transactionsRefundsByRefundIdResource
    ]);

    // Transactions GET Lambda Function
    this.transactionsPublicGetFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsPublicGetFunction',
      'src/handlers/transactions/_bookingId/GET',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // GET /transactions
    this.transactionsResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsPublicGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /transactions/{bookingId}
    this.transactionsByTransactionIdResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsPublicGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions POST Lambda Function
    this.transactionsPublicPostFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsPublicPostFunction',
      'src/handlers/transactions/_bookingId/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /transactions
    this.transactionsResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsPublicPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Refunds GET Lambda Function
    this.transactionsPublicRefundsGetFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsPublicRefundsGetFunction',
      'src/handlers/transactions/_bookingId/refunds/GET',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // GET /transactions/{bookingId}/refunds
    this.transactionsRefundsResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsPublicRefundsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // GET /transactions/{bookingId}/refunds/{refundId}
    this.transactionsRefundsByRefundIdResource.addMethod('GET', new apigw.LambdaIntegration(this.transactionsPublicRefundsGetFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Refunds POST Lambda Function
    this.transactionsPublicRefundsPostFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsPublicRefundsPostFunction',
      'src/handlers/transactions/_bookingId/refunds/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
      }
    );

    // POST /transactions/{bookingId}/refunds
    this.transactionsRefundsResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsPublicRefundsPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Add SNS permissions to the refunds POST function
    if (props.refundRequestTopicArn) {
      const snsPolicy = new iam.PolicyStatement({
        actions: ['sns:Publish'],
        resources: [props.refundRequestTopicArn],
      });
      this.transactionsPublicRefundsPostFunction.addToRolePolicy(snsPolicy);

      // Add KMS permissions if KMS key is provided
      if (props?.kmsKey) {
        this.transactionsPublicRefundsPostFunction.addToRolePolicy(new iam.PolicyStatement({
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
      this.transactionsPublicGetFunction,
      this.transactionsPublicPostFunction,
      this.transactionsPublicRefundsGetFunction,
      this.transactionsPublicRefundsPostFunction,
    ];

    for (const func of functions) {
      this.grantBasicTransDataTableReadWrite(func);
    }

    const paymentApiSecret = props.environment?.PAYMENTS_API_SECRET
    const merchantIdSecret = props.environment?.MERCHANT_ID_SECRET
    const hashKeySecret = props.environment?.HASH_KEY_SECRET

    // Grant read permissions for all transaction secrets to the POST/Refund functions
    if (props.environment && paymentApiSecret && merchantIdSecret && hashKeySecret) {
      const stack = Stack.of(this);

      const paymentsApiArnPattern = `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${paymentApiSecret}*`;
      const merchantIdArnPattern = `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${merchantIdSecret}*`;
      const hashKeyArnPattern = `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${hashKeySecret}*`;

      const functionsThatNeedSecret = [
        this.transactionsPublicPostFunction,
        this.transactionsPublicRefundsPostFunction,
      ];

      for (const func of functionsThatNeedSecret) {
        func.addToRolePolicy(new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [paymentsApiArnPattern, merchantIdArnPattern, hashKeyArnPattern],
        }));
      }
    }
  }
}

module.exports = {
  AdminTransactionsConstruct,
  PublicTransactionsConstruct,
};
