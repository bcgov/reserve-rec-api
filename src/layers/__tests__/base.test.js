// Layers are required through their /opt/* runtime path, which jest maps back to source
// (see moduleNameMapper in jest.config.js). The previous .aws-sam/build path is a generated
// artifact that does not exist in a clean checkout, so this suite never ran.

describe('Base Layer Tests', () => {
    const OLD_ENV = process.env;
    beforeEach(async () => {
        jest.resetModules();
        process.env = { ...OLD_ENV }; // Make a copy of environment
    });

    afterAll(() => {
        process.env = OLD_ENV; // Restore old environment
    });

    test('Test sendResponse', async () => {
        // Success
        const layer = require('/opt/base');
        const response = layer.sendResponse(200, { items: [1, 2, 3] }, 'Success', null);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body)).toEqual({
            code: 200,
            data: { items: [1, 2, 3] },
            msg: 'Success',
            error: null
        });

        //Error with extra items.
        const error = layer.sendResponse(400, [], 'Error', { error: 'error' }, null, { other1: 1, other2: 2 });
        expect(error.statusCode).toBe(400);
        expect(JSON.parse(error.body)).toEqual({
            code: 400,
            data: [],
            msg: 'Error',
            error: { error: 'error' },
            context: null,
            other1: 1,
            other2: 2
        });
    });

    test('sendResponse survives an error that cannot be serialized', async () => {
        // Regression: a DynamoDB ValidationException reached sendResponse with the SDK's
        // circular `IncomingMessage -> req -> res` chain attached. JSON.stringify threw, the
        // Lambda returned nothing, and API Gateway served an opaque 502 instead of the real
        // cause -- which broke public product-dates for a full release cycle.
        const layer = require('/opt/base');

        const awsError = new Error('Value provided in ExpressionAttributeValues unused in expressions: keys: {:pk}');
        awsError.name = 'ValidationException';
        const res = {};
        const req = {};
        res.req = req;
        req.res = res;
        awsError.$response = res;

        let response;
        expect(() => {
            response = layer.sendResponse(400, null, awsError.message, awsError, null);
        }).not.toThrow();

        expect(response.statusCode).toBe(400);
        const body = JSON.parse(response.body);
        expect(body.error).toEqual({
            name: 'ValidationException',
            message: 'Value provided in ExpressionAttributeValues unused in expressions: keys: {:pk}'
        });
        expect(body.msg).toBe(awsError.message);
    });

    test('sendResponse tolerates a circular payload', async () => {
        const layer = require('/opt/base');
        const circular = { a: 1 };
        circular.self = circular;

        const response = layer.sendResponse(200, circular, 'Success', null, null);
        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.body).data).toEqual({ a: 1, self: '[Circular]' });
    });

    test('sendResponse clamps a status code API Gateway would reject', async () => {
        // An out-of-range statusCode makes API Gateway discard the response and return its
        // own 502, hiding whatever the handler meant to say.
        const layer = require('/opt/base');
        expect(layer.sendResponse(1000, null, 'Error', null, null).statusCode).toBe(500);
        expect(layer.sendResponse(undefined, null, 'Error', null, null).statusCode).toBe(500);
        expect(JSON.parse(layer.sendResponse(1000, null, 'Error', null, null).body).code).toBe(500);
    });

    test('Check warmup', async () => {
        const layer = require('/opt/base');
        expect(await layer.checkWarmup({})).toBeFalsy();
        expect(await layer.checkWarmup({ warmup: false })).toBeFalsy();
        expect(await layer.checkWarmup({ warmup: true })).toBeTruthy();
    });
});
