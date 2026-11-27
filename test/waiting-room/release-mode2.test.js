'use strict';

const mockLambdaSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  ...jest.requireActual('@aws-sdk/client-lambda'),
  LambdaClient: jest.fn(() => ({ send: mockLambdaSend })),
}));

jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({ getActiveMode2QueueId: jest.fn() }));

const { handler } = require('../../src/handlers/waiting-room/admin/release-mode2');
const { getActiveMode2QueueId } = require('../../src/handlers/waiting-room/utils/dynamodb');

const adminEvent = (permissions) => ({
  requestContext: { authorizer: { principalId: 'admin-sub', permissions: JSON.stringify(permissions) } },
});
const SUPERADMIN = adminEvent({ superadmin: 'superadmin' });
const lambdaReply = (payload, extra = {}) => ({ Payload: Buffer.from(JSON.stringify(payload)), ...extra });
const body = (res) => JSON.parse(res.body);

describe('WaitingRoom admin RELEASE-MODE2', () => {
  beforeEach(() => {
    mockLambdaSend.mockReset();
    getActiveMode2QueueId.mockReset();
    process.env.RELEASE_LAMBDA_ARN = 'arn:aws:lambda:ca-central-1:123:function:release';
    // The pointer names yesterday's (UTC) queue: Mode 2 was switched on before the date rolled over.
    jest.useFakeTimers({ now: new Date('2026-07-02T01:00:00Z') });
    getActiveMode2QueueId.mockResolvedValue('QUEUE#MODE2#global#1#2026-07-01');
  });
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.RELEASE_LAMBDA_ARN;
  });

  it('force-invokes the release Lambda for the active Mode 2 queue and reports the count', async () => {
    mockLambdaSend.mockResolvedValue(lambdaReply({ admitted: 7, result: 'released' }));

    const res = await handler(SUPERADMIN);

    const input = mockLambdaSend.mock.calls[0][0].input;
    expect(input.FunctionName).toBe('arn:aws:lambda:ca-central-1:123:function:release');
    expect(input.InvocationType).toBe('RequestResponse');
    expect(JSON.parse(Buffer.from(input.Payload).toString())).toEqual({ queueId: 'QUEUE#MODE2#global#1#2026-07-01', force: true });
    expect(res.statusCode).toBe(200);
    expect(body(res)).toMatchObject({
      msg: 'Released 7 user(s) from Mode 2 queue',
      data: { queueId: 'QUEUE#MODE2#global#1#2026-07-01', admitted: 7, result: 'released' },
    });
  });

  it('reports zero admitted when the release Lambda omits a count', async () => {
    mockLambdaSend.mockResolvedValue(lambdaReply({ result: 'nothing-to-release' }));
    const res = await handler(SUPERADMIN);
    expect(body(res).data.admitted).toBe(0);
    expect(body(res).msg).toBe('Released 0 user(s) from Mode 2 queue');
  });

  it.each([
    ['an HQ admin', { bcparks_1: 'staff' }],
    ['a caller with no permissions', {}],
  ])('refuses %s with 403 without reading the queue or invoking a release', async (_, permissions) => {
    const res = await handler(adminEvent(permissions));
    expect(res.statusCode).toBe(403);
    expect(getActiveMode2QueueId).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('returns 409 without invoking when Mode 2 is not active', async () => {
    getActiveMode2QueueId.mockResolvedValue(null);
    const res = await handler(SUPERADMIN);
    expect(res.statusCode).toBe(409);
    expect(body(res).msg).toBe('Mode 2 is not active');
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('returns 503 without invoking when the release Lambda is not configured', async () => {
    delete process.env.RELEASE_LAMBDA_ARN;
    const res = await handler(SUPERADMIN);
    expect(res.statusCode).toBe(503);
    expect(mockLambdaSend).not.toHaveBeenCalled();
  });

  it('returns 502 when the release Lambda reports a function error', async () => {
    mockLambdaSend.mockResolvedValue(lambdaReply({ errorMessage: 'boom' }, { FunctionError: 'Unhandled' }));
    const res = await handler(SUPERADMIN);
    expect(res.statusCode).toBe(502);
    expect(body(res).msg).toBe('Release Lambda failed');
  });

  it('returns 500 when the invoke itself fails', async () => {
    mockLambdaSend.mockRejectedValue(new Error('network'));
    const res = await handler(SUPERADMIN);
    expect(res.statusCode).toBe(500);
    expect(body(res).msg).toBe('Internal server error');
  });
});
