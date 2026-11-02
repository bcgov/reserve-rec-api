'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { AUDIT_TABLE_ARN, TRANS_TABLE_ARN, actionsOn, allActions, synthConstruct } = require('../helpers/cdkConstruct');
const { AdminTransactionsConstruct, PublicTransactionsConstruct } = require('../../src/handlers/transactions/constructs');

const DIR = 'src/handlers/transactions/_bookingId';
const WRITE = ['dynamodb:BatchWriteItem', 'dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'];
const READ = ['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'];
const COGNITO = ['cognito-idp:AdminGetUser', 'cognito-idp:ListUsers'];
const TOPIC = 'arn:aws:sns:ca-central-1:111111111111:refund-requests';
const KEY = 'arn:aws:kms:ca-central-1:111111111111:key/abc';

const environment = (api) => ({
  MERCHANT_ID_SECRET: `/reserveRecApi/test/${api}/merchantId`,
  HASH_KEY_SECRET: `/reserveRecApi/test/${api}/hashKey`,
  PAYMENTS_API_SECRET: `/reserveRecApi/test/${api}/paymentsApiPasscode`,
  WORLDLINE_PAYMENT_API_URL: 'https://api.na.bambora.com/v1/payments',
});

// Secret ARNs are built from stack tokens, so match on the secret path inside the Fn::Join.
const secretNamed = (name) => (resource) => JSON.stringify(resource).includes(`:secret:${name}*`);
const secretsRead = (role, api) => ['merchantId', 'hashKey', 'paymentsApiPasscode']
  .map((name) => actionsOn(role, secretNamed(`/reserveRecApi/test/${api}/${name}`)));

describe('AdminTransactionsConstruct', () => {
  let routes, roles;
  beforeAll(() => {
    const result = synthConstruct(AdminTransactionsConstruct, {
      handlerPrefix: 'admin',
      environment: environment('adminApiStack'),
      refundRequestTopicArn: TOPIC,
      kmsKey: { keyArn: KEY },
    });
    routes = result.routes;
    roles = result.roles;
  });

  it('routes every admin transactions endpoint to its admin handler behind the custom authorizer', () => {
    const get = { auth: 'CUSTOM', handler: `${DIR}/GET/admin.js` };
    const refundsGet = { auth: 'CUSTOM', handler: `${DIR}/refunds/GET/admin.js` };
    expect(routes).toEqual({
      'GET /transactions/admin': get,
      'GET /transactions/admin/{bookingId}': get,
      'POST /transactions/admin': { auth: 'CUSTOM', handler: `${DIR}/POST/admin.js` },
      'GET /transactions/admin/{bookingId}/refunds': refundsGet,
      'GET /transactions/admin/{bookingId}/refunds/{refundId}': refundsGet,
      'POST /transactions/admin/{bookingId}/refunds': { auth: 'CUSTOM', handler: `${DIR}/refunds/POST/admin.js` },
    });
  });

  it('passes the Worldline settings and table names to the handlers', () => {
    expect(roles[`${DIR}/POST/admin.js`].env).toMatchObject({
      ...environment('adminApiStack'),
      TRANSACTIONAL_DATA_TABLE_NAME: 'TransTable',
      AUDIT_TABLE_NAME: 'AuditTable',
    });
  });

  it('lets the admin GET handlers read transactions', () => {
    for (const file of ['GET/admin.js', 'refunds/GET/admin.js']) {
      expect(actionsOn(roles[`${DIR}/${file}`], TRANS_TABLE_ARN)).toEqual(expect.arrayContaining(READ));
    }
  });

  it('lets the admin POST handlers write transactions and the audit log', () => {
    for (const file of ['POST/admin.js', 'refunds/POST/admin.js']) {
      const role = roles[`${DIR}/${file}`];
      expect(actionsOn(role, TRANS_TABLE_ARN)).toEqual(expect.arrayContaining(WRITE));
      expect(actionsOn(role, AUDIT_TABLE_ARN)).toEqual(['dynamodb:BatchWriteItem', 'dynamodb:PutItem']);
    }
  });

  it('lets only the payment and refund handlers read the Worldline secrets', () => {
    const read = ['secretsmanager:GetSecretValue'];
    expect(secretsRead(roles[`${DIR}/POST/admin.js`], 'adminApiStack')).toEqual([read, read, read]);
    expect(secretsRead(roles[`${DIR}/refunds/POST/admin.js`], 'adminApiStack')).toEqual([read, read, read]);
    expect(allActions(roles[`${DIR}/GET/admin.js`])).not.toContain('secretsmanager:GetSecretValue');
  });

  it('lets the payment handler resolve the owner from Cognito and the refund handler publish refunds', () => {
    expect(allActions(roles[`${DIR}/POST/admin.js`])).toEqual(expect.arrayContaining(COGNITO));
    const refunds = roles[`${DIR}/refunds/POST/admin.js`];
    expect(actionsOn(refunds, TOPIC)).toEqual(['sns:Publish']);
    expect(actionsOn(refunds, KEY)).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
  });

  it('grants no secret, topic or key access when none are configured', () => {
    const { roles: bare } = synthConstruct(AdminTransactionsConstruct, { handlerPrefix: 'admin' });
    const actions = allActions(bare[`${DIR}/refunds/POST/admin.js`]);

    expect(actions).not.toEqual(expect.arrayContaining(['secretsmanager:GetSecretValue']));
    expect(actions).not.toContain('sns:Publish');
    expect(actions).not.toContain('kms:Decrypt');
  });
});

describe('PublicTransactionsConstruct', () => {
  let routes, roles;
  beforeAll(() => {
    const result = synthConstruct(PublicTransactionsConstruct, {
      handlerPrefix: 'public',
      environment: environment('publicApiStack'),
      refundRequestTopicArn: TOPIC,
    });
    routes = result.routes;
    roles = result.roles;
  });

  it('routes every public transactions endpoint to its public handler behind the custom authorizer', () => {
    const get = { auth: 'CUSTOM', handler: `${DIR}/GET/public.js` };
    const refundsGet = { auth: 'CUSTOM', handler: `${DIR}/refunds/GET/public.js` };
    expect(routes).toEqual({
      'GET /transactions': get,
      'GET /transactions/{bookingId}': get,
      'POST /transactions': { auth: 'CUSTOM', handler: `${DIR}/POST/public.js` },
      'GET /transactions/{bookingId}/refunds': refundsGet,
      'GET /transactions/{bookingId}/refunds/{refundId}': refundsGet,
      'POST /transactions/{bookingId}/refunds': { auth: 'CUSTOM', handler: `${DIR}/refunds/POST/public.js` },
    });
  });

  it('lets the public payment handler charge cards and complete the booking', () => {
    const role = roles[`${DIR}/POST/public.js`];
    const read = ['secretsmanager:GetSecretValue'];
    expect(secretsRead(role, 'publicApiStack')).toEqual([read, read, read]);
    expect(actionsOn(role, TRANS_TABLE_ARN)).toEqual(expect.arrayContaining(WRITE));
    expect(allActions(role)).toEqual(expect.arrayContaining(COGNITO));
    expect(role.env).toMatchObject(environment('publicApiStack'));
  });

  it('gives public handlers no audit-table access', () => {
    for (const role of Object.values(roles)) {
      expect(actionsOn(role, AUDIT_TABLE_ARN)).toEqual([]);
    }
  });

  it('lets the public refund handler publish refund requests', () => {
    expect(actionsOn(roles[`${DIR}/refunds/POST/public.js`], TOPIC)).toEqual(['sns:Publish']);
  });
});
