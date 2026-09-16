"use strict";

// The booking-hold marker is the atomic backstop for the "one hold per
// user/product/date" rule (issue #458). Its key is built at create time from
// request props and rebuilt at cleanup time from the persisted booking — those
// two keys MUST match, including when activityId/productId come back from
// DynamoDB as numbers rather than the request's strings. These tests pin that.

jest.mock("/opt/dynamodb", () => ({
  marshall: jest.fn((v) => ({ S: String(v) })),
  runQuery: jest.fn(),
  getOne: jest.fn(),
  quickApiPutHandler: jest.fn(),
  REFERENCE_DATA_TABLE_NAME: "reference-data",
  TRANSACTIONAL_DATA_TABLE_NAME: "transactional-data",
  SPARSE_GSI1_NAME: "sparse-gsi1",
  USERID_INDEX_NAME: "userId-index",
  USERID_PROPERTY_NAME: "gsipk",
}));
jest.mock("/opt/sns", () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
jest.mock("/opt/cognito", () => ({}), { virtual: true });
jest.mock("../../activities/methods", () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));

const {
  buildBookingHoldMarkerKey,
  deleteBookingHoldMarker,
} = require("../methods");

const createProps = {
  userId: "user-abc",
  collectionId: "bcparks_8",
  activityType: "dayuse",
  activityId: "2",   // request query params arrive as strings
  productId: "2",
  startDate: "2026-09-17",
};

describe("booking-hold marker key", () => {
  it("builds the deterministic per-user/product/date key", () => {
    expect(buildBookingHoldMarkerKey(createProps)).toEqual({
      pk: "bookinghold::user-abc::bcparks_8::dayuse::2::2",
      sk: "2026-09-17",
    });
  });

  it("produces an identical key whether ids are strings or numbers", () => {
    // The persisted booking stores activityId/productId as numbers; cleanup must
    // rebuild the exact same key the create path wrote, or the marker leaks.
    const persistedBooking = {
      userId: "user-abc",
      collectionId: "bcparks_8",
      activityType: "dayuse",
      activityId: 2,
      productId: 2,
      startDate: "2026-09-17",
    };
    expect(buildBookingHoldMarkerKey(persistedBooking))
      .toEqual(buildBookingHoldMarkerKey(createProps));
  });

  it("emits an idempotent (unconditional) Delete for cleanup", () => {
    const req = deleteBookingHoldMarker(createProps);
    expect(req.action).toBe("Delete");
    expect(req.data.TableName).toBe("transactional-data");
    expect(req.data.Key).toEqual({
      pk: { S: "bookinghold::user-abc::bcparks_8::dayuse::2::2" },
      sk: { S: "2026-09-17" },
    });
    // No ConditionExpression — deleting an already-gone marker must not throw.
    expect(req.data.ConditionExpression).toBeUndefined();
  });
});
