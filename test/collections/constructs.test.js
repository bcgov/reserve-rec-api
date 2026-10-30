'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { synthConstruct, authByRoute, writerCount } = require('../helpers/cdkConstruct');
const { PublicCollectionsConstruct, AdminCollectionsConstruct } = require('../../src/handlers/collections/constructs');

describe('collections constructs', () => {
  it('public API exposes only the open GET routes', () => {
    expect(authByRoute(synthConstruct(PublicCollectionsConstruct, { authorizer: undefined }).routes)).toEqual({
      'GET /collections': 'NONE',
      'GET /collections/{collectionId}': 'NONE',
    });
  }, 30000);

  it('admin API puts reads and writes behind the authorizer', () => {
    const { routes, grants } = synthConstruct(AdminCollectionsConstruct);
    expect(authByRoute(routes)).toEqual({
      'GET /collections': 'CUSTOM',
      'GET /collections/{collectionId}': 'CUSTOM',
      'POST /collections': 'CUSTOM',
      'PUT /collections/{collectionId}': 'CUSTOM',
      'DELETE /collections/{collectionId}': 'CUSTOM',
    });
    expect(writerCount(grants)).toBe(4);
  }, 30000);
});
