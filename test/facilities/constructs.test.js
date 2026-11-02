'use strict';

jest.mock('aws-cdk-lib/aws-lambda-nodejs', () => require('../helpers/cdkConstruct').nodejsFunctionMock());

const { synthConstruct } = require('../helpers/cdkConstruct');
const { PublicFacilitiesConstruct, AdminFacilitiesConstruct } = require('../../src/handlers/facilities/constructs');

const DIR = 'src/handlers/facilities/_collectionId';
const COL = '/facilities/{collectionId}';
const TYPE = `${COL}/{facilityType}`;
const ID = `${TYPE}/{facilityId}`;

describe('PublicFacilitiesConstruct', () => {
  it('exposes only unauthenticated GETs on the public handler', () => {
    const { routes } = synthConstruct(PublicFacilitiesConstruct, { authorizer: undefined });
    const get = { auth: 'NONE', handler: `${DIR}/GET/public.js` };
    expect(routes).toEqual({ [`GET ${COL}`]: get, [`GET ${TYPE}`]: get, [`GET ${ID}`]: get });
  });
});

describe('AdminFacilitiesConstruct', () => {
  let routes, grants;
  beforeAll(() => {
    ({ routes, grants } = synthConstruct(AdminFacilitiesConstruct));
  });

  it('routes every method to its admin handler behind the authorizer', () => {
    const at = (method) => ({ auth: 'CUSTOM', handler: `${DIR}/${method}/admin.js` });
    expect(routes).toEqual({
      [`GET ${COL}`]: at('GET'), [`GET ${TYPE}`]: at('GET'), [`GET ${ID}`]: at('GET'),
      [`POST ${COL}`]: at('POST'), [`POST ${TYPE}`]: at('POST'),
      [`PUT ${COL}`]: at('PUT'), [`PUT ${TYPE}`]: at('PUT'), [`PUT ${ID}`]: at('PUT'),
      [`DELETE ${ID}`]: at('DELETE'),
    });
  });

  it('grants every handler read/write on the reference table', () => {
    expect(Object.keys(grants)).toHaveLength(4);
    for (const actions of Object.values(grants)) {
      expect(actions).toEqual(expect.arrayContaining(['dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem']));
    }
  });
});
