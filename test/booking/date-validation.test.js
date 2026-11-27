"use strict";

jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code || null;
    this.data = data?.data || null;
  }),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sendResponse: jest.fn((status, data, message) => ({ status, data, message })),
  getRequestClaimsFromEvent: jest.fn(() => ({ sub: "test-user-123" })),
}));

jest.mock("../../src/handlers/bookings/methods", () => ({
  createBooking: jest.fn(),
  formatBookingResponsePublic: jest.fn(),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  isTransactionConflict: jest.fn(() => false),
}));

jest.mock("../../src/handlers/waiting-room/utils/token", () => ({
  parseAdmissionCookie: jest.fn(() => null),
  validateToken: jest.fn(),
}));
jest.mock("../../src/handlers/waiting-room/utils/secrets", () => ({ getHmacSigningKey: jest.fn() }));
jest.mock("../../src/handlers/waiting-room/utils/dynamodb", () => ({
  getQueueMeta: jest.fn(),
  getActiveMode2Meta: jest.fn(async () => null),
  buildQueueId: jest.requireActual("../../src/handlers/waiting-room/utils/dynamodb").buildQueueId,
}));

const { handler } = require("../../src/handlers/bookings/POST/public");
const { createBooking, formatBookingResponsePublic } = require("../../src/handlers/bookings/methods");
const { getQueueMeta } = require("../../src/handlers/waiting-room/utils/dynamodb");

const QUEUED_DAY = "2026-12-01";
const post = (dates) => handler({
  body: JSON.stringify({
    collectionId: "bcparks_1", activityType: "dayuse", activityId: "1", productId: "p1", quantity: 1, ...dates,
  }),
}, {});

describe("Bookings POST date validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WAITING_ROOM_TABLE_NAME = "waiting-room";
    process.env.HMAC_SIGNING_KEY_ARN = "hmac-key";
    // Only the queued day has a live facility queue.
    getQueueMeta.mockImplementation(async (queueId) => (queueId.endsWith(`#${QUEUED_DAY}`) ? { queueStatus: "open" } : null));
    createBooking.mockResolvedValue({ requestItems: [] });
    formatBookingResponsePublic.mockReturnValue({});
  });

  afterEach(() => {
    delete process.env.WAITING_ROOM_TABLE_NAME;
    delete process.env.HMAC_SIGNING_KEY_ARN;
  });

  it.each([
    ["an impossible day", { startDate: "2026-11-31", endDate: QUEUED_DAY }],
    ["a truncated day", { startDate: "2026-12-0", endDate: QUEUED_DAY }],
    ["February 30", { startDate: "2026-02-30" }],
    ["an unpadded month", { startDate: "2026-1-05" }],
    ["a non-date string", { startDate: "tomorrow" }],
    ["a date with a time", { startDate: `${QUEUED_DAY}T00:00:00` }],
    ["a non-string date", { startDate: 20261201 }],
    ["an impossible endDate", { startDate: QUEUED_DAY, endDate: "2026-12-32" }],
    ["endDate before startDate", { startDate: QUEUED_DAY, endDate: "2026-11-30" }],
  ])("refuses %s before any queue or booking lookup", async (_, dates) => {
    const result = await post(dates);
    expect(result.status).toBe(400);
    expect(result.data).toMatchObject({ refusal: "invalid" });
    expect(getQueueMeta).not.toHaveBeenCalled();
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("still holds a valid date range to the waiting room", async () => {
    const result = await post({ startDate: QUEUED_DAY, endDate: "2026-12-02" });
    expect(result.status).toBe(403);
    expect(result.data).toMatchObject({ refusal: "waiting_room" });
    expect(createBooking).not.toHaveBeenCalled();
  });

  it("books a valid date with no live queue", async () => {
    const result = await post({ startDate: "2026-12-05", endDate: "2026-12-05" });
    expect(result.status).toBe(200);
    expect(createBooking).toHaveBeenCalledWith(expect.objectContaining({ startDate: "2026-12-05", endDate: "2026-12-05" }));
  });
});
