'use strict';

const mockGenerateJWKS = jest.fn();
const mockDecryptJWE = jest.fn();
jest.mock('/opt/jwt', () => ({
  JWTManager: jest.fn(() => ({ generateJWKS: mockGenerateJWKS, decryptJWE: mockDecryptJWE })),
}), { virtual: true });
jest.mock('axios');

const axios = require('axios');
const { handler: getHandler } = require('../../src/handlers/bcsc/GET/index');
const { handler: postHandler } = require('../../src/handlers/bcsc/POST/index');

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;
const JWE = 'h.k.iv.ct.tag';

beforeEach(() => {
  jest.resetAllMocks();
});

describe('BCSC GET', () => {
  it('answers preflight with an empty 200', async () => {
    const res = await getHandler({ httpMethod: 'OPTIONS', path: '/bcsc/userinfo/dev' });
    expect(res).toMatchObject({ statusCode: 200, body: '' });
  });

  it('serves the JWKS document', async () => {
    mockGenerateJWKS.mockResolvedValue({ keys: [{ kid: 'k1' }] });
    const res = await getHandler({ httpMethod: 'GET', path: '/bcsc/jwks' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ keys: [{ kid: 'k1' }] });
  });

  it('proxies userinfo to the env endpoint with the caller Authorization and decrypts the JWE', async () => {
    axios.get.mockResolvedValue({ status: 200, data: JWE });
    mockDecryptJWE.mockResolvedValue(jwt({ sub: 'bcsc-1', email: 'a@example.com', email_verified: false }));

    const res = await getHandler({ httpMethod: 'GET', path: '/bcsc/userinfo/test', headers: { authorization: 'Bearer abc', host: 'x' } });

    expect(axios.get).toHaveBeenCalledWith('https://idtest.gov.bc.ca/oauth2/userinfo', { headers: { Authorization: 'Bearer abc' }, timeout: 25000 });
    expect(mockDecryptJWE).toHaveBeenCalledWith(JWE);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ sub: 'bcsc-1', email: 'a@example.com', email_verified: true });
  });

  it('keeps the provider email_verified flag in prod', async () => {
    axios.get.mockResolvedValue({ status: 200, data: JWE });
    mockDecryptJWE.mockResolvedValue(jwt({ sub: 'bcsc-1', email_verified: false }));

    const res = await getHandler({ httpMethod: 'GET', path: '/bcsc/userinfo/prod', headers: {} });

    expect(axios.get).toHaveBeenCalledWith('https://id.gov.bc.ca/oauth2/userinfo', { headers: {}, timeout: 25000 });
    expect(JSON.parse(res.body).email_verified).toBe(false);
  });

  it.each([
    ['a non-string body', { sub: 'x' }, null],
    ['a JWE without 5 parts', 'a.b.c', null],
    ['a decrypted token that is not a JWT', JWE, 'only.two'],
  ])('returns 500 server_error for %s', async (_, data, decrypted) => {
    axios.get.mockResolvedValue({ status: 200, data });
    mockDecryptJWE.mockResolvedValue(decrypted);
    const res = await getHandler({ httpMethod: 'GET', path: '/bcsc/userinfo/dev', headers: {} });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'server_error' });
  });

  it.each([
    ['a timeout', Object.assign(new Error('timeout'), { code: 'ECONNABORTED' })],
    ['a provider error', Object.assign(new Error('401'), { response: { status: 401, data: 'bad token', headers: {} } })],
  ])('returns 500 server_error on %s', async (_, err) => {
    axios.get.mockRejectedValue(err);
    const res = await getHandler({ httpMethod: 'GET', path: '/bcsc/userinfo/dev', headers: { Authorization: 'Bearer x' } });
    expect(res.statusCode).toBe(500);
    expect(mockDecryptJWE).not.toHaveBeenCalled();
  });
});

describe('BCSC POST token exchange', () => {
  it('answers preflight', async () => {
    const res = await postHandler({ httpMethod: 'OPTIONS', path: '/bcsc/token/dev' });
    expect(res).toMatchObject({ statusCode: 200, body: '' });
  });

  it('rejects an unknown env path with invalid_request', async () => {
    const res = await postHandler({ httpMethod: 'POST', path: '/bcsc/token/staging' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_request', error_description: 'Invalid path format' });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('forwards the decoded body without host headers and strips id_token from the reply', async () => {
    axios.post.mockResolvedValue({ status: 200, data: { access_token: 'at', id_token: 'it', token_type: 'Bearer' } });
    const form = 'grant_type=authorization_code&code=xyz';

    const res = await postHandler({
      httpMethod: 'POST',
      path: '/bcsc/token/prod',
      headers: { Host: 'api', host: 'api', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: Buffer.from(form).toString('base64'),
      isBase64Encoded: true,
    });

    expect(axios.post).toHaveBeenCalledWith('https://id.gov.bc.ca/oauth2/token', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 25000,
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ access_token: 'at', token_type: 'Bearer' });
  });

  it('passes a plain body through and relays the provider status on failure', async () => {
    axios.post.mockRejectedValue(Object.assign(new Error('Request failed'), { response: { status: 401, data: { error: 'invalid_grant' } } }));
    const res = await postHandler({ httpMethod: 'POST', path: '/bcsc/token/dev', headers: {}, body: 'code=1' });
    expect(axios.post.mock.calls[0][1]).toBe('code=1');
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'server_error', error_description: 'Request failed', bcsc_error: { error: 'invalid_grant' } });
  });

  it('returns 500 when the provider is unreachable', async () => {
    axios.post.mockRejectedValue(new Error('ENOTFOUND'));
    const res = await postHandler({ httpMethod: 'POST', path: '/bcsc/token/test', headers: {}, body: '' });
    expect(res.statusCode).toBe(500);
  });
});
