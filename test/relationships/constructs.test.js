'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { synthConstruct, authByRoute, writerCount } = require('../helpers/cdkConstruct');
const { RelationshipsConstruct } = require('../../src/handlers/relationships/constructs');

describe('RelationshipsConstruct', () => {
  // The relationship handlers do no permission check of their own, so the authorizer is the only gate.
  it('puts every route behind the authorizer', () => {
    const { routes, grants } = synthConstruct(RelationshipsConstruct);
    expect(authByRoute(routes)).toEqual({
      'POST /relationships': 'CUSTOM',
      'GET /relationships/{pk1}/{sk1}': 'CUSTOM',
      'DELETE /relationships/{pk1}/{sk1}/{pk2}/{sk2}': 'CUSTOM',
      'GET /relationships/reverse/{pk2}/{sk2}': 'CUSTOM',
    });
    expect(writerCount(grants)).toBe(4);
  }, 30000);
});
