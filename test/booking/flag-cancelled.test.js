"use strict";

// Mock the same heavy dependencies methods.js pulls in at require-time, then
// exercise flagCancelledBooking directly.
jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("/opt/dynamodb", () => ({
  TRANSACTIONAL_DATA_TABLE_NAME: "trans",
  REFERENCE_DATA_TABLE_NAME: "ref",
  SPARSE_GSI1_NAME: "gsi1",
  USERID_INDEX_NAME: "userIdx",
  USERID_PROPERTY_NAME: "userId",
  getOneByGlobalId: jest.fn(),
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
}));

jest.mock("/opt/sns", () => ({
  snsPublishCommand: jest.fn(),
  snsPublishSend: jest.fn(),
}), { virtual: true });

jest.mock("../../lib/handlers/emailDispatch/utils", () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));

jest.mock("../../src/handlers/users/methods", () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
}));
jest.mock("../../src/handlers/activities/methods", () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock("../../src/common/data-utils", () => ({
  getAndAttachNestedProperties: jest.fn(),
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));
jest.mock("../../src/handlers/productDates/methods", () => ({
  fetchProductDates: jest.fn(),
}));
jest.mock("@aws-sdk/util-dynamodb", () => ({
  unmarshall: jest.fn((x) => x),
}));

const { flagCancelledBooking } = require("../../src/handlers/bookings/methods");

const booking = { pk: "booking::1", sk: "1", bookingId: "BK-1" };
const queryTime = 1700000000000;
const userId = "user-1";

describe("flagCancelledBooking", () => {
  it("omits cancellationReason when no reason is provided", async () => {
    const [op] = await flagCancelledBooking(booking, queryTime, undefined, userId);

    expect(op.action).toBe("Update");
    expect(op.data.UpdateExpression).not.toContain("cancellationReason");
    expect(op.data.ExpressionAttributeNames).not.toHaveProperty(
      "#cancellationReason"
    );
    expect(op.data.ExpressionAttributeValues).not.toHaveProperty(
      ":cancellationReason"
    );
  });

  it("persists cancellationReason when one is provided", async () => {
    const [op] = await flagCancelledBooking(
      booking,
      queryTime,
      "Trip cancelled due to weather",
      userId
    );

    expect(op.data.UpdateExpression).toContain(
      "#cancellationReason = :cancellationReason"
    );
    expect(op.data.ExpressionAttributeNames["#cancellationReason"]).toBe(
      "cancellationReason"
    );
    expect(op.data.ExpressionAttributeValues[":cancellationReason"]).toEqual({
      S: "Trip cancelled due to weather",
    });
  });

  it("includes the full atomic race-guard ConditionExpression", async () => {
    const [op] = await flagCancelledBooking(booking, queryTime, undefined, userId);
    expect(op.data.ConditionExpression).toBe(
      "attribute_exists(#pk) AND #userId = :userId AND attribute_not_exists(#cancellationTime)"
    );
    expect(op.data.ExpressionAttributeValues[":userId"]).toEqual({ S: userId });
    expect(op.data.ExpressionAttributeNames["#pk"]).toBe("pk");
    expect(op.data.ExpressionAttributeNames["#userId"]).toBe("userId");
  });

  it("throws when userId is missing — guards against the silent-fail trap", async () => {
    await expect(flagCancelledBooking(booking, queryTime)).rejects.toThrow(
      /requires a userId/
    );
    await expect(flagCancelledBooking(booking, queryTime, "r", "")).rejects.toThrow(
      /requires a userId/
    );
  });

  it("coerces non-string reasons via String() and still persists them", async () => {
    const [op] = await flagCancelledBooking(booking, queryTime, 12345, userId);
    expect(op.data.ExpressionAttributeValues[":cancellationReason"]).toEqual({
      S: "12345",
    });
  });
});
