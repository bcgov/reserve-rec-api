const { LambdaConstruct } = require("../../../lib/helpers/base-lambda");
const apigw = require("aws-cdk-lib/aws-apigateway");
const iam = require("aws-cdk-lib/aws-iam");
const { Duration, Stack } = require("aws-cdk-lib");
const { EVENT_LOG_RETENTION } = require("../../../lib/helpers/event-metrics");

const defaults = {
  resources: {
    transactionsAdminGetFunction: {
      name: 'TransAdminGET',
    },
    transactionsAdminPostFunction: {
      name: 'TransAdminPOST',
    },
    transactionsAdminReconcileFunction: {
      name: 'TransAdminRecPOST',
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

// The event= lines the payment handlers log, for addEventMetrics in the nested stacks.
const PAYMENT_POST_EVENTS = [
  'payment_reconciled',
  'payment_voided',
  'payment_void_failed',
  'payment_record_failed',
  'payment_unconfirmed',
  'payment_booking_completion_failed',
  'payment_duplicate_refused',
  'payment_attempts_exhausted',
];
const PAYMENT_RECONCILE_EVENTS = [
  'payment_reconciled',
  'payment_record_failed',
  'payment_reconcile_requested',
  'payment_reconcile_not_found',
];

// Reconciliation lookups (2 x 3 s) and the 7 s charge can outlast the 10 s default;
// API Gateway gives up at 29 s.
const PAYMENT_LAMBDA_PROPS = {
  timeout: Duration.seconds(25),
  // addEventMetrics needs the log group managed through logRetention.
  logRetention: EVENT_LOG_RETENTION,
};

function secretArn(scope, secretPath) {
  const stack = Stack.of(scope);
  return `arn:aws:secretsmanager:${stack.region}:${stack.account}:secret:${secretPath}*`;
}

/**
 * REPORTING_API_SECRET for a stack's transactions functions: the path of its `reportingApiPasscode`
 * secret, or nothing when synth could not read that secret (the primer then stores the secret's
 * id or key as its value), so reconciliation skips the lookup rather than fail it.
 */
function reportingApiSecretEnv(stack) {
  const secret = stack.secrets?.reportingApiPasscode;
  if (!secret?.value || [secret.id, secret.key].includes(secret.value)) return {};
  return { REPORTING_API_SECRET: secret.path };
}

// Order-number lookups for stuck payments; unset means reconciliation skips the lookup.
function grantReportingSecretRead(scope, environment, functions) {
  if (!environment?.REPORTING_API_SECRET) return;
  for (const func of functions) {
    func.addToRolePolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [secretArn(scope, environment.REPORTING_API_SECRET)],
    }));
  }
}

// The payment POST confirms the booking, so it sends the same confirmation email and SMS
// as POST /bookings/{id}/complete and needs the same queues.
function wireNotificationQueues(fn, props) {
  if (props?.emailQueueUrl) fn.addEnvironment('EMAIL_QUEUE_URL', props.emailQueueUrl);
  if (props?.smsReminderQueueUrl) fn.addEnvironment('SMS_REMINDER_QUEUE_URL', props.smsReminderQueueUrl);
  const queueArns = [props?.emailQueueArn, props?.smsReminderQueueArn].filter(Boolean);
  if (queueArns.length) {
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['sqs:SendMessage', 'sqs:GetQueueUrl'],
      resources: queueArns,
    }));
  }
  // The email queue is encrypted with the shared KMS key.
  if (props?.emailQueueArn && props?.kmsKey) {
    fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [props.kmsKey.keyArn],
    }));
  }
}

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

    // Add /transactions/admin/{bookingId}/reconcile resource
    this.transactionsReconcileResource = this.transactionsByTransactionIdResource.addResource('reconcile');

    // Add /transactions/admin/{bookingId}/refunds resource
    this.transactionsRefundsResource = this.transactionsByTransactionIdResource.addResource('refunds');

    // Add /transactions/admin/{bookingId}/refunds/{refundId} resource
    this.transactionsRefundsByRefundIdResource = this.transactionsRefundsResource.addResource('{refundId}');

    // Add CORS preflight for transactions
    this.addCorsPreflightForResources([
      this.transactionsResource,
      this.transactionsAdminResource,
      this.transactionsByTransactionIdResource,
      this.transactionsReconcileResource,
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
        // completeBooking reads the public pool id from the reference config.
        basicRead: true,
        transDataBasicReadWrite: true,
        ...PAYMENT_LAMBDA_PROPS,
      }
    );

    // completeBooking resolves the booking owner's identity from Cognito.
    this.transactionsAdminPostFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"],
    }));

    wireNotificationQueues(this.transactionsAdminPostFunction, props);

    // POST /transactions
    this.transactionsAdminResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsAdminPostFunction), {
      authorizationType: apigw.AuthorizationType.CUSTOM,
      authorizer: this.resolveAuthorizer(),
    });

    // Transactions Reconcile POST Lambda Function
    this.transactionsAdminReconcileFunction = this.generateBasicLambdaFn(
      scope,
      'transactionsAdminReconcileFunction',
      'src/handlers/transactions/_bookingId/reconcile/POST',
      handlerName,
      {
        transDataBasicReadWrite: true,
        ...PAYMENT_LAMBDA_PROPS,
      }
    );

    // POST /transactions/{bookingId}/reconcile
    this.transactionsReconcileResource.addMethod('POST', new apigw.LambdaIntegration(this.transactionsAdminReconcileFunction), {
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
      this.transactionsAdminReconcileFunction,
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
      const paymentsApiArnPattern = secretArn(this, paymentApiSecret);
      const merchantIdArnPattern = secretArn(this, merchantIdSecret);
      const hashKeyArnPattern = secretArn(this, hashKeySecret);

      const functionsThatNeedSecret = [
        this.transactionsAdminPostFunction,
        this.transactionsAdminReconcileFunction,
        this.transactionsAdminRefundsPostFunction,
      ];

      for (const func of functionsThatNeedSecret) {
        func.addToRolePolicy(new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [paymentsApiArnPattern, merchantIdArnPattern, hashKeyArnPattern],
        }));
      }
    }

    grantReportingSecretRead(this, props.environment, [
      this.transactionsAdminPostFunction,
      this.transactionsAdminReconcileFunction,
    ]);
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
        // completeBooking reads the public pool id from the reference config.
        basicRead: true,
        transDataBasicReadWrite: true,
        ...PAYMENT_LAMBDA_PROPS,
      }
    );

    // completeBooking resolves the booking owner's identity from Cognito.
    this.transactionsPublicPostFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:AdminGetUser",
        "cognito-idp:ListUsers",
      ],
      resources: ["*"],
    }));

    wireNotificationQueues(this.transactionsPublicPostFunction, props);

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
      const paymentsApiArnPattern = secretArn(this, paymentApiSecret);
      const merchantIdArnPattern = secretArn(this, merchantIdSecret);
      const hashKeyArnPattern = secretArn(this, hashKeySecret);

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

    grantReportingSecretRead(this, props.environment, [this.transactionsPublicPostFunction]);
  }
}

module.exports = {
  AdminTransactionsConstruct,
  PublicTransactionsConstruct,
  PAYMENT_POST_EVENTS,
  PAYMENT_RECONCILE_EVENTS,
  reportingApiSecretEnv,
};
