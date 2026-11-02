'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { AUDIT_TABLE_ARN, TRANS_TABLE_ARN, actionsOn, allActions, synthConstruct } = require('../helpers/cdkConstruct');
const { AdminBookingsConstruct, PublicBookingsConstruct } = require('../../src/handlers/bookings/constructs');

const DIR = 'src/handlers/bookings';
const READ = ['dynamodb:BatchGetItem', 'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan'];
const WRITE = ['dynamodb:BatchWriteItem', 'dynamodb:DeleteItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'];
const COGNITO = ['cognito-idp:AdminGetUser', 'cognito-idp:ListUsers'];
const SEARCH_DOMAIN = 'arn:aws:es:ca-central-1:111111111111:domain/search';

// The public construct hangs its by-activity route off the activities construct's resource.
const withActivities = (ConstructClass) => class extends ConstructClass {
  constructor(scope, id, props) {
    props.api.root.addResource('activities').addResource('{collectionId}').addResource('{activityType}').addResource('{activityId}');
    super(scope, id, props);
  }
};

describe('AdminBookingsConstruct', () => {
  let routes, roles;
  beforeAll(() => {
    const result = synthConstruct(AdminBookingsConstruct, {
      handlerPrefix: 'admin',
      openSearchDomainArn: SEARCH_DOMAIN,
      environment: { LOG_LEVEL: 'debug' },
    });
    routes = result.routes;
    roles = result.roles;
  });

  it('routes every admin bookings endpoint to its handler behind the custom authorizer', () => {
    expect(routes).toEqual({
      'GET /bookings/admin': { auth: 'CUSTOM', handler: `${DIR}/GET/admin.js` },
      'GET /bookings/admin/user/{userId}': { auth: 'CUSTOM', handler: `${DIR}/admin/user/_userId/GET/admin.js` },
      'POST /bookings/search': { auth: 'CUSTOM', handler: `${DIR}/search/POST/index.js` },
      'PUT /bookings/{bookingId}/checkin': { auth: 'CUSTOM', handler: `${DIR}/_bookingId/check-in/PUT/admin.js` },
      'PUT /bookings/{bookingId}/checkout': { auth: 'CUSTOM', handler: `${DIR}/_bookingId/check-out/PUT/admin.js` },
    });
  });

  it('gives every handler the table names plus the stack environment', () => {
    expect(roles[`${DIR}/GET/admin.js`].env).toMatchObject({
      REFERENCE_DATA_TABLE_NAME: 'RefTable',
      TRANSACTIONAL_DATA_TABLE_NAME: 'TransTable',
      AUDIT_TABLE_NAME: 'AuditTable',
      LOG_LEVEL: 'debug',
    });
  });

  it('keeps the admin search and per-user listing read-only on the bookings table', () => {
    for (const file of ['GET/admin.js', 'admin/user/_userId/GET/admin.js']) {
      expect(actionsOn(roles[`${DIR}/${file}`], TRANS_TABLE_ARN)).toEqual(READ);
    }
  });

  it('lets check-in and check-out update bookings, write the audit log and read Cognito', () => {
    for (const file of ['check-in/PUT/admin.js', 'check-out/PUT/admin.js']) {
      const role = roles[`${DIR}/_bookingId/${file}`];
      expect(actionsOn(role, TRANS_TABLE_ARN)).toEqual(expect.arrayContaining(WRITE));
      expect(actionsOn(role, AUDIT_TABLE_ARN)).toEqual(['dynamodb:BatchWriteItem', 'dynamodb:PutItem']);
      expect(allActions(role)).toEqual(expect.arrayContaining(COGNITO));
    }
  });

  it('lets the search handler query the OpenSearch domain', () => {
    expect(actionsOn(roles[`${DIR}/search/POST/index.js`], `${SEARCH_DOMAIN}/*`)).toEqual(['es:ESHttpGet', 'es:ESHttpPost']);
  });

  it('grants no OpenSearch access when no domain is configured', () => {
    const { roles: noSearch } = synthConstruct(AdminBookingsConstruct, { handlerPrefix: 'admin' });

    expect(allActions(noSearch[`${DIR}/search/POST/index.js`])).not.toContain('es:ESHttpPost');
  });
});

describe('PublicBookingsConstruct', () => {
  let routes, grants, roles;
  beforeAll(() => {
    const result = synthConstruct(withActivities(PublicBookingsConstruct), {
      handlerPrefix: 'public',
      kmsKey: { keyArn: 'arn:aws:kms:ca-central-1:111111111111:key/abc' },
    });
    ({ routes, grants } = result);
    roles = result.roles;
  });

  it('routes every public bookings endpoint to its handler behind the custom authorizer', () => {
    const get = { auth: 'CUSTOM', handler: `${DIR}/GET/public.js` };
    const post = { auth: 'CUSTOM', handler: `${DIR}/POST/public.js` };
    const byActivity = '/activities/{collectionId}/{activityType}/{activityId}/{startDate}/bookings';
    expect(routes).toEqual({
      'GET /bookings': get,
      'GET /bookings/{bookingId}': get,
      [`GET ${byActivity}`]: get,
      'POST /bookings': post,
      [`POST ${byActivity}`]: post,
      'POST /bookings/{bookingId}/complete': { auth: 'CUSTOM', handler: `${DIR}/_bookingId/complete/POST/public.js` },
      'POST /bookings/{bookingId}/cancel': { auth: 'CUSTOM', handler: `${DIR}/_bookingId/cancel/POST/index.js` },
      'POST /bookings/{bookingId}/remove': { auth: 'CUSTOM', handler: `${DIR}/_bookingId/remove/POST/public.js` },
    });
  });

  it('keeps the booking reads read-only on the bookings table', () => {
    expect(actionsOn(roles[`${DIR}/GET/public.js`], TRANS_TABLE_ARN)).toEqual(READ);
  });

  it('lets create, complete, cancel and remove write bookings and read the owner from Cognito', () => {
    for (const file of ['POST/public.js', '_bookingId/complete/POST/public.js', '_bookingId/cancel/POST/index.js', '_bookingId/remove/POST/public.js']) {
      const role = roles[`${DIR}/${file}`];
      expect(actionsOn(role, TRANS_TABLE_ARN)).toEqual(expect.arrayContaining(WRITE));
      expect(allActions(role)).toEqual(expect.arrayContaining(COGNITO));
    }
  });

  it('lets create update inventory and complete read park names from the reference table', () => {
    expect(grants[`${DIR}/POST/public.js`]).toEqual(expect.arrayContaining(['dynamodb:UpdateItem', 'dynamodb:Query']));
    expect(grants[`${DIR}/_bookingId/complete/POST/public.js`]).toEqual(expect.arrayContaining(['dynamodb:Query']));
  });

  it('lets only the cancel handler use the KMS key', () => {
    const keyArn = 'arn:aws:kms:ca-central-1:111111111111:key/abc';
    expect(actionsOn(roles[`${DIR}/_bookingId/cancel/POST/index.js`], keyArn)).toEqual(['kms:Decrypt', 'kms:GenerateDataKey']);
    expect(actionsOn(roles[`${DIR}/_bookingId/remove/POST/public.js`], keyArn)).toEqual([]);
  });

  it('fails fast when the activities resource is missing', () => {
    expect(() => synthConstruct(PublicBookingsConstruct, { handlerPrefix: 'public' }))
      .toThrow(/Missing required \/activities\/\{collectionId\}\/\{activityType\}\/\{activityId\} resource/);
  });
});
