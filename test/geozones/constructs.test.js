'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { synthConstruct, authByRoute, writerCount } = require('../helpers/cdkConstruct');
const { GeozonesConstruct } = require('../../src/handlers/geozones/constructs');

const WRITES = {
  'POST /geozones/{collectionId}': 'CUSTOM',
  'PUT /geozones/{collectionId}': 'CUSTOM',
  'PUT /geozones/{collectionId}/{geozoneId}': 'CUSTOM',
  'DELETE /geozones/{collectionId}/{geozoneId}': 'CUSTOM',
};

describe('GeozonesConstruct', () => {
  it('puts every route behind the authorizer by default', () => {
    expect(authByRoute(synthConstruct(GeozonesConstruct, { handlerPrefix: 'admin' }).routes)).toEqual({
      'GET /geozones/{collectionId}': 'CUSTOM',
      'GET /geozones/{collectionId}/{geozoneId}': 'CUSTOM',
      ...WRITES,
    });
  }, 30000);

  it('with publicRead opens only the GET routes', () => {
    const { routes, grants } = synthConstruct(GeozonesConstruct, { handlerPrefix: 'admin', publicRead: true });
    expect(authByRoute(routes)).toEqual({
      'GET /geozones/{collectionId}': 'NONE',
      'GET /geozones/{collectionId}/{geozoneId}': 'NONE',
      ...WRITES,
    });
    expect(writerCount(grants)).toBe(4);
  }, 30000);
});
