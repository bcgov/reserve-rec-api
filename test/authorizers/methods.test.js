'use strict';

const mockGetOne = jest.fn();
jest.mock('/opt/dynamodb', () => ({ getOne: (...a) => mockGetOne(...a) }));

const methods = require('../../src/handlers/authorizers/methods');

const ARN = 'arn:aws:execute-api:ca-central-1:123456789012:abc123/api/GET/facilities/bcparks_7';

describe('authorizer methods', () => {
  beforeEach(() => mockGetOne.mockReset());

  it('authorizeAll allows every route of the calling API', async () => {
    await expect(methods.authorizeAll({ methodArn: ARN })).resolves.toEqual({
      principalId: 'pub',
      policyDocument: {
        Version: '2012-10-17',
        Statement: [{ Action: 'execute-api:Invoke', Effect: 'Allow', Resource: 'arn:aws:execute-api:ca-central-1:123456789012:abc123/*' }],
      },
    });
  });

  it('getDenyPolicy denies exactly the requested ARN', async () => {
    const res = await methods.getDenyPolicy(ARN);
    expect(res.principalId).toBe('user');
    expect(res.policyDocument.Statement).toEqual([{ Action: 'execute-api:Invoke', Effect: 'Deny', Resource: ARN }]);
  });

  it('generatePolicy omits the policy document without an effect or resource', () => {
    expect(methods.generatePolicy('p', null, ARN)).toEqual({ principalId: 'p' });
    expect(methods.generatePolicy('p', 'Allow', '')).toEqual({ principalId: 'p' });
  });

  it('queryAndGenerateResources returns the tier map, or {} when absent', async () => {
    mockGetOne.mockResolvedValueOnce({ allowedResources: { GET: ['facilities'] } }).mockResolvedValueOnce({}).mockResolvedValueOnce(null);
    await expect(methods.queryAndGenerateResources('staff')).resolves.toEqual({ GET: ['facilities'] });
    expect(mockGetOne).toHaveBeenCalledWith('resourceMap::staff', 'latest');
    await expect(methods.queryAndGenerateResources('limited')).resolves.toEqual({});
    await expect(methods.queryAndGenerateResources('none')).resolves.toEqual({});
  });

  it.each([
    [undefined, { valid: false }],
    ['', { valid: false }],
    ['None', { valid: false }],
    ['Bearer', { valid: false }],
    ['Bearer a b', { valid: false }],
    ['bearer tok', { valid: false }],
    ['Bearer tok', { valid: true, token: 'tok' }],
  ])('parseToken(%j) -> %j', async (authorization, expected) => {
    await expect(methods.parseToken({}, authorization)).resolves.toEqual(expected);
  });

  it('handleContextAndAPIKey treats an authenticated flag without a payload as a guest', () => {
    expect(methods.handleContextAndAPIKey({}, null, {}, true).context).toMatchObject({ isAuthenticated: 'false', userId: 'guest' });
    expect(methods.handleContextAndAPIKey({}, {}, {}, true).context).toMatchObject({ isAuthenticated: 'true', userId: '', email: '', username: '' });
  });
});
