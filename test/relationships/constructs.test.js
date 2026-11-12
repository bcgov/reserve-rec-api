'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { auditWriters, synthConstruct, authByRoute, writerCount } = require('../helpers/cdkConstruct');
const { RelationshipsConstruct } = require('../../src/handlers/relationships/constructs');

describe('RelationshipsConstruct', () => {
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

  it('lets only the POST and DELETE handlers write the audit table', () => {
    const { roles } = synthConstruct(RelationshipsConstruct);
    const DIR = 'src/handlers/relationships';
    expect(auditWriters(roles)).toEqual([
      `${DIR}/POST/admin.js`,
      `${DIR}/_compoundPk1/_compoundSk1/_compoundPk2/_compoundSk2/DELETE/admin.js`,
    ]);
  }, 30000);
});
