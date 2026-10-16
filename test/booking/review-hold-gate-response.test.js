'use strict';

// The real sendResponse, so the comparison covers status, headers and body as sent.
jest.mock('/opt/base', () => ({
  ...jest.requireActual('/opt/base'),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/handlers/bookings/methods', () => ({
  createBooking: jest.fn(),
  formatBookingResponsePublic: jest.fn(),
  completeBooking: jest.fn(),
  sendBookingConfirmationEmail: jest.fn(),
}));
jest.mock('../../src/handlers/bookings/notifications', () => ({ enqueueSmsReminderIfNeeded: jest.fn() }));
jest.mock('/opt/dynamodb', () => ({
  batchTransactData: jest.fn(),
  isTransactionConflict: jest.requireActual('/opt/dynamodb').isTransactionConflict,
}));
jest.mock('../../src/handlers/waiting-room/utils/token', () => ({ parseAdmissionCookie: jest.fn(), validateToken: jest.fn() }));
jest.mock('../../src/handlers/waiting-room/utils/secrets', () => ({ getHmacSigningKey: jest.fn() }));
jest.mock('../../src/handlers/waiting-room/utils/dynamodb', () => ({ getQueueMeta: jest.fn(), buildQueueId: jest.fn() }));

const { logger } = require('/opt/base');
const { createBooking, completeBooking } = require('../../src/handlers/bookings/methods');
const { genericRefusal } = require('../../src/handlers/bookings/refusals');
const { handler: holdHandler } = require('../../src/handlers/bookings/POST/public');
const { handler: completeHandler } = require('../../src/handlers/bookings/_bookingId/complete/POST/public');

const SUB = 'sub-1';
const holdEvent = () => ({
  body: JSON.stringify({
    collectionId: 'c', activityType: 'dayuse', activityId: 'a', productId: 'p', startDate: '2026-07-01', quantity: 1,
  }),
  requestContext: { authorizer: { isAuthenticated: 'true', claims: { sub: SUB, username: SUB } } },
});
const completeEvent = () => ({
  pathParameters: { bookingId: 'b-1' },
  body: JSON.stringify({ sessionId: 's-1' }),
  requestContext: { authorizer: { userId: SUB, username: SUB } },
});
const unexpectedFault = () => Object.assign(new Error('connect ECONNRESET'), { name: 'TimeoutError' });
const events = () => [...logger.info.mock.calls, ...logger.error.mock.calls]
  .map(([msg]) => msg).filter((msg) => String(msg).startsWith('event='));

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(1767225600000);
});
afterEach(() => jest.restoreAllMocks());

describe('POST /bookings review gate response', () => {
  it('is byte-identical to the response for an unexpected failure', async () => {
    createBooking.mockRejectedValueOnce(genericRefusal('hold_gate'));
    const gated = await holdHandler(holdEvent(), {});
    createBooking.mockRejectedValueOnce(unexpectedFault());
    const failed = await holdHandler(holdEvent(), {});

    expect(gated.statusCode).toBe(400);
    expect(gated.body).toBe(failed.body);
    expect(gated).toEqual(failed);
  });

  it('carries no reason in the body', async () => {
    createBooking.mockRejectedValueOnce(genericRefusal('hold_gate'));
    const { body } = await holdHandler(holdEvent(), {});

    expect(JSON.parse(body)).toEqual({
      code: 400, data: null, msg: 'Failed to create booking. Please try again.', error: null, serverTime: 1767225600000,
    });
    expect(body).not.toMatch(/hold_gate|refusal|review/i);
  });

  it('logs hold_refused_hold_gate, where the fault logs hold_failed', async () => {
    createBooking.mockRejectedValueOnce(genericRefusal('hold_gate'));
    await holdHandler(holdEvent(), {});
    createBooking.mockRejectedValueOnce(unexpectedFault());
    await holdHandler(holdEvent(), {});

    expect(events()).toEqual(['event=hold_refused_hold_gate', 'event=hold_failed']);
  });
});

describe('POST /bookings/{id}/complete review gate response', () => {
  it('is byte-identical to the response for an unexpected failure', async () => {
    completeBooking.mockRejectedValueOnce(genericRefusal('hold_gate'));
    const gated = await completeHandler(completeEvent(), {});
    completeBooking.mockRejectedValueOnce(unexpectedFault());
    const failed = await completeHandler(completeEvent(), {});

    expect(gated.statusCode).toBe(400);
    expect(gated.body).toBe(failed.body);
    expect(gated).toEqual(failed);
    expect(gated.body).not.toMatch(/hold_gate|refusal|review/i);
  });

  it('logs complete_refused_hold_gate', async () => {
    completeBooking.mockRejectedValueOnce(genericRefusal('hold_gate'));
    await completeHandler(completeEvent(), {});
    expect(events()).toEqual(['event=complete_refused_hold_gate']);
  });
});
