'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { synthConstruct } = require('../helpers/cdkConstruct');
const { PoliciesConstruct } = require('../../src/handlers/policies/constructs');

const DIR = 'src/handlers/policies';

describe('PoliciesConstruct', () => {
  let routes, grants;
  beforeAll(() => {
    ({ routes, grants } = synthConstruct(PoliciesConstruct, { handlerPrefix: 'admin' }));
  });

  it('routes every policies endpoint to its admin handler behind the custom authorizer', () => {
    const get = { auth: 'CUSTOM', handler: `${DIR}/GET/admin.js` };
    const del = { auth: 'CUSTOM', handler: `${DIR}/DELETE/admin.js` };
    expect(routes).toEqual({
      'GET /policies': get,
      'GET /policies/{policyType}': get,
      'GET /policies/{policyType}/{policyId}': get,
      'GET /policies/{policyType}/{policyId}/{policyIdVersion}': get,
      'POST /policies/{policyType}': { auth: 'CUSTOM', handler: `${DIR}/POST/admin.js` },
      'PUT /policies/{policyType}/{policyId}': { auth: 'CUSTOM', handler: `${DIR}/PUT/admin.js` },
      'DELETE /policies/{policyType}/{policyId}': del,
      'DELETE /policies/{policyType}/{policyId}/{policyIdVersion}': del,
    });
  });

  it('lets the POST and PUT handlers write the reference table', () => {
    for (const method of ['POST', 'PUT']) {
      expect(grants[`${DIR}/${method}/admin.js`]).toEqual(
        expect.arrayContaining(['dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:Query']),
      );
    }
  });

  it('fails fast without an authorizer', () => {
    expect(() => synthConstruct(PoliciesConstruct, { handlerPrefix: 'admin', authorizer: undefined }))
      .toThrow(/missing required property "authorizer"/);
  });
});
