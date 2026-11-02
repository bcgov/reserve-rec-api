'use strict';

describe('GET /ping', () => {
  it('names the API in its success message', async () => {
    process.env.API_NAME = 'PublicApi';
    let handler;
    jest.isolateModules(() => {
      jest.spyOn(console, 'log').mockImplementation(() => {});
      ({ handler } = require('../../src/handlers/ping/index'));
    });
    const res = await handler({}, {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ data: 'PublicApi ping success.', msg: 'Success' });
    delete process.env.API_NAME;
  });
});
