'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { synthConstruct } = require('../helpers/cdkConstruct');
const { ActivitiesConstruct } = require('../../src/handlers/activities/constructs');

const DIR = 'src/handlers/activities/_collectionId';
const writeRoutes = {
  'POST /activities/{collectionId}': { auth: 'CUSTOM', handler: `${DIR}/POST/admin.js` },
  'PUT /activities/{collectionId}': { auth: 'CUSTOM', handler: `${DIR}/PUT/admin.js` },
  'PUT /activities/{collectionId}/{activityType}/{activityId}': { auth: 'CUSTOM', handler: `${DIR}/PUT/admin.js` },
  'DELETE /activities/{collectionId}/{activityType}/{activityId}': { auth: 'CUSTOM', handler: `${DIR}/DELETE/admin.js` },
};

describe('ActivitiesConstruct', () => {
  it('puts reads behind the authorizer on the admin API', () => {
    const { routes } = synthConstruct(ActivitiesConstruct);
    const get = { auth: 'CUSTOM', handler: `${DIR}/GET/admin.js` };
    expect(routes).toEqual({
      'GET /activities/{collectionId}': get,
      'GET /activities/{collectionId}/{activityType}/{activityId}': get,
      ...writeRoutes,
    });
  });

  it('opens reads to the public handler with publicRead, keeping writes authorized', () => {
    const { routes } = synthConstruct(ActivitiesConstruct, { handlerPrefix: 'public', publicRead: true });
    const get = { auth: 'NONE', handler: `${DIR}/GET/public.js` };
    expect(routes).toEqual({
      'GET /activities/{collectionId}': get,
      'GET /activities/{collectionId}/{activityType}/{activityId}': get,
      ...writeRoutes,
    });
  });

  it('grants every handler read/write on the reference table', () => {
    const { grants } = synthConstruct(ActivitiesConstruct);
    expect(Object.keys(grants)).toHaveLength(4);
    for (const actions of Object.values(grants)) {
      expect(actions).toEqual(expect.arrayContaining(['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem']));
    }
  });
});
