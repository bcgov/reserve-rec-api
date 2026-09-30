"use strict";

// validateBookingRequest throws the specific reason as a plain string, then its
// catch wraps it in an Exception. The wrapper must surface that specific reason
// (so the client sees "outside the reservation window", not a generic message),
// while keeping unexpected errors generic so internals don't leak.

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data?.data || null;
  }),
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
  sendResponse: jest.fn(),
}));
jest.mock("/opt/dynamodb", () => ({
  marshall: jest.fn((v) => v),
  runQuery: jest.fn(),
  getOne: jest.fn(),
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

const { validateBookingRequest } = require("../methods");

const product = {
  reservationPolicy: { isReservable: true, minTotalDays: 1, maxTotalDays: 14 },
  timezone: "America/Vancouver",
  activitySubType: "vehicleParking",
};

function productDate(overrides = {}) {
  return {
    date: "2026-09-25",
    reservationContext: {
      isReservable: true,
      temporalWindows: { reservationWindow: { open: 1000, close: 9_999_999_999_999 } },
      maxDailyInventory: 4,
      minDailyInventory: 1,
    },
    ...overrides,
  };
}

describe("validateBookingRequest error surfacing", () => {
  it("surfaces the specific reason when the reservation window is not open", async () => {
    const pd = productDate();
    pd.reservationContext.temporalWindows.reservationWindow.open = 9_000_000_000_000; // far future
    await expect(
      validateBookingRequest(product, [pd], { queryTime: 1000, invQuantity: 1 })
    ).rejects.toMatchObject({
      code: 400,
      message: "It is outside the reservation window for ProductDate 2026-09-25",
    });
  });

  it("surfaces the specific reason for a non-reservable product date", async () => {
    const pd = productDate({ reservationContext: { isReservable: false } });
    await expect(
      validateBookingRequest(product, [pd], { queryTime: 5000, invQuantity: 1 })
    ).rejects.toMatchObject({
      code: 400,
      message: "ProductDate 2026-09-25 is not reservable",
    });
  });

  it("stays generic for an unexpected (non-string) error, without leaking internals", async () => {
    // reservationContext.isReservable is true but temporalWindows is missing, so
    // reading resWindow.open throws a TypeError inside the try.
    const pd = productDate({ reservationContext: { isReservable: true } });
    await expect(
      validateBookingRequest(product, [pd], { queryTime: 5000, invQuantity: 1 })
    ).rejects.toMatchObject({
      code: 400,
      message: "Error validating booking request",
    });
  });

  describe("tags each deliberate refusal", () => {
    const context = (overrides) => productDate({ reservationContext: { ...productDate().reservationContext, ...overrides } });
    const trailUse = { ...product, activitySubType: "trailUse" };
    const policy = (overrides) => ({ ...product, reservationPolicy: { ...product.reservationPolicy, ...overrides } });

    it.each([
      ["window", "the reservation window is not open", product,
        [context({ temporalWindows: { reservationWindow: { open: 9_000_000_000_000, close: 9_999_999_999_999 } } })], 1],
      ["invalid", "a vehicle parking quantity over one", product, [productDate()], 2],
      ["invalid", "a quantity over the daily maximum", trailUse, [context({ maxDailyInventory: 1 })], 2],
      ["invalid", "a quantity under the daily minimum", trailUse, [context({ minDailyInventory: 3 })], 2],
      ["invalid", "fewer days than the minimum", policy({ minTotalDays: 2 }), [productDate()], 1],
      ["invalid", "more days than the maximum", policy({ maxTotalDays: 1 }), [productDate(), productDate()], 1],
      ["state", "a product that is not reservable", policy({ isReservable: false }), [productDate()], 1],
      ["state", "a product date that is not reservable", product,
        [productDate({ reservationContext: { isReservable: false } })], 1],
    ])("as %s for %s", async (refusal, _, prod, pds, invQuantity) => {
      await expect(
        validateBookingRequest(prod, pds, { queryTime: 5000, invQuantity })
      ).rejects.toMatchObject({ code: 400, data: { refusal } });
    });
  });

  it("passes a valid request", async () => {
    await expect(
      validateBookingRequest(product, [productDate()], { queryTime: 5000, invQuantity: 1 })
    ).resolves.toBe(true);
  });
});
