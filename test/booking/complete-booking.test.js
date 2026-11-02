"use strict";

// completeBooking and its email/response builders with the real data-utils update builder.
jest.mock("/opt/base", () => {
  const { DateTime } = require("luxon");
  return {
    DateTime,
    Exception: jest.fn(function (message, data) {
      this.message = message;
      this.code = data?.code;
      this.data = data?.data;
    }),
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    getNowISO: jest.fn(() => "2026-06-10T12:00:00.000Z"),
    epochToISO: jest.fn(),
    isoToEpoch: jest.fn(),
  };
});

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
  batchGetData: jest.fn(),
  batchTransactData: jest.fn(),
}));
jest.mock("/opt/sns", () => ({ snsPublishCommand: jest.fn(), snsPublishSend: jest.fn() }), { virtual: true });
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
jest.mock("../../src/handlers/productDates/methods", () => ({ fetchProductDates: jest.fn() }));
jest.mock("@aws-sdk/util-dynamodb", () => ({ unmarshall: jest.fn((x) => x) }));

const { getOneByGlobalId, getOne, runQuery } = require("/opt/dynamodb");
const { getUserInfoBySub } = require("../../src/handlers/users/methods");
const {
  completeBooking,
  formatBookingResponsePublic,
  generateEmailParams,
  getExpiredBookings,
} = require("../../src/handlers/bookings/methods");

const NOW = new Date("2026-06-10T12:00:00Z").getTime();

function storedBooking(overrides = {}) {
  return {
    pk: "booking::bcparks_8::dayuse::1::2",
    sk: "2026-06-12::bk-1",
    bookingId: "bk-1",
    sessionId: "sess-1",
    sessionExpiry: NOW + 10 * 60 * 1000,
    status: "in progress",
    userId: "sub-1",
    collectionId: "bcparks_8",
    activityType: "dayuse",
    productId: "2",
    displayName: "Lindsay's Loop - AM (2026-06-12)",
    productDisplayName: "Lindsay's Loop - AM",
    smsOptIn: true,
    ...overrides,
  };
}

const BOOKING_DATES = [
  { pk: "bookingDate::bk-1", date: "2026-06-13", quantity: 1,
    reservationContext: { temporalAnchors: { checkOutTime: 1781380800000 } } },
  { pk: "bookingDate::bk-1", date: "2026-06-12", quantity: 2,
    reservationContext: { temporalAnchors: { checkInTime: 1781258400000 } } },
];

const GEOZONES = [
  { sk: "counter", displayName: "ignored" },
  { sk: "2", geozoneId: 2, displayName: "Second Zone" },
  { sk: "1", geozoneId: 1, displayName: "Golden Ears Park" },
];

function routeRunQuery({ bookingDates = BOOKING_DATES, geozones = GEOZONES } = {}) {
  runQuery.mockImplementation(async (query) => {
    const pk = query.ExpressionAttributeValues?.[":pk"]?.S || query.ExpressionAttributeValues?.[":pk"];
    if (pk === "bookingDate::bk-1") return { items: bookingDates };
    if (pk === "geozone::bcparks_8") return { items: geozones };
    return { items: [] };
  });
}

function cognitoUser(attrs) {
  return { Attributes: Object.entries(attrs).map(([Name, Value]) => ({ Name, Value })) };
}

describe("completeBooking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
    delete process.env.PUBLIC_FRONTEND_DOMAIN;
    getOneByGlobalId.mockResolvedValue(storedBooking());
    getOne.mockResolvedValue({ review: { state: "approved" } });
    getUserInfoBySub.mockResolvedValue(cognitoUser({
      given_name: "Jane",
      family_name: "Camper",
      email: "jane@example.com",
      phone_number: "+12505550100",
      email_verified: "true",
    }));
    routeRunQuery();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const body = () => ({
    smsOptIn: false,
    namedOccupant: {
      firstName: "Mallory",
      contactInfo: { email: "mallory@example.com", postalCode: "  V8V 1A1  ", city: "Victoria" },
    },
    vehicleInformation: Array.from({ length: 7 }, (_, i) => ({ licensePlate: ` PLATE${i} `, licensePlateRegistrationRegion: "BC" })),
    equipmentInformation: "tent",
  });

  it("confirms the hold with the Cognito identity, not the identity in the request body", async () => {
    const { updateRequests, ownerIdentity } = await completeBooking("bk-1", "sess-1", body(), { sub: "sub-1" });

    const [op] = updateRequests;
    expect(op.action).toBe("Update");
    expect(op.data.Key).toEqual({ pk: "booking::bcparks_8::dayuse::1::2", sk: "2026-06-12::bk-1" });
    expect(op.data.ConditionExpression).toBe("attribute_exists(isPending) AND #status = :inProgress");
    expect(op.data.UpdateExpression).toContain("REMOVE #isPending");
    const values = op.data.ExpressionAttributeValues;
    expect(values[":inProgress"]).toBe("in progress");
    expect(values[":status"]).toBe("confirmed");
    expect(values[":bookingCompletionTime"]).toBe(NOW);
    expect(values[":namedOccupant"]).toMatchObject({
      firstName: "Jane",
      lastName: "Camper",
      contactInfo: { email: "jane@example.com", mobilePhone: "+12505550100", postalCode: "V8V 1A1", city: "Victoria" },
    });
    expect(ownerIdentity.email).toBe("jane@example.com");
  });

  it("keeps at most five trimmed vehicles", async () => {
    const { updateRequests } = await completeBooking("bk-1", "sess-1", body(), { sub: "sub-1" });

    const vehicles = updateRequests[0].data.ExpressionAttributeValues[":vehicleInformation"];
    expect(vehicles.map((v) => v.licensePlate)).toEqual(["PLATE0", "PLATE1", "PLATE2", "PLATE3", "PLATE4"]);
  });

  it("builds confirmation email and SMS params from the completed booking", async () => {
    const { emailParams, smsParams } = await completeBooking("bk-1", "sess-1", body(), { sub: "sub-1" });

    expect(emailParams.customer).toEqual({
      firstName: "Jane", lastName: "Camper", licensePlate: "PLATE0", licensePlateRegion: "BC",
    });
    expect(emailParams.location).toEqual({ parkName: "Golden Ears Park" });
    expect(smsParams.smsOptIn).toBe(false);
    expect(smsParams.namedOccupant.contactInfo.mobilePhone).toBe("+12505550100");
  });

  it("falls back to the opt-in stored on the booking when the request has none", async () => {
    const props = body();
    delete props.smsOptIn;

    const { smsParams } = await completeBooking("bk-1", "sess-1", props, { sub: "sub-1" });

    expect(smsParams.smsOptIn).toBe(true);
  });

  it("leaves the stored occupant alone on a server-side completion with no sub", async () => {
    const { updateRequests, ownerIdentity } = await completeBooking("bk-1", "sess-1", body(), {});

    const values = updateRequests[0].data.ExpressionAttributeValues;
    expect(values).not.toHaveProperty(":namedOccupant");
    expect(values).not.toHaveProperty(":vehicleInformation");
    expect(values[":status"]).toBe("confirmed");
    expect(ownerIdentity).toBeNull();
    expect(getUserInfoBySub).not.toHaveBeenCalled();
  });

  it("refuses a caller who does not own the booking", async () => {
    await expect(completeBooking("bk-1", "sess-1", body(), { sub: "sub-2" }))
      .rejects.toMatchObject({ code: 403, data: { refusal: "owner" } });
  });

  it("skips the review gate once payment has started", async () => {
    getOne.mockResolvedValue({ review: { state: "pending" } });

    const { updateRequests } = await completeBooking("bk-1", "sess-1", body(), { sub: "sub-1", paymentStarted: true });

    expect(updateRequests[0].data.ExpressionAttributeValues[":status"]).toBe("confirmed");
  });
});

describe("generateEmailParams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PUBLIC_FRONTEND_DOMAIN;
  });

  it("orders booking dates for arrival/departure and links to the public account pages", async () => {
    routeRunQuery();
    process.env.PUBLIC_FRONTEND_DOMAIN = "https://reserve.example.ca";

    const params = await generateEmailParams(storedBooking());

    expect(params.booking).toMatchObject({
      bookingId: "bk-1",
      invQuantity: 3,
      arrivalDate: 1781258400000,
      departureDate: 1781380800000,
      accountBookingUrl: "https://reserve.example.ca/account/bookings/bk-1",
      cancellationUrl: "https://reserve.example.ca/account/bookings/cancel/bk-1",
      activityType: "Dayuse",
      activityTypeLabel: "Day-use pass",
      productName: "Lindsay's Loop - AM",
    });
    expect(params.location.parkName).toBe("Golden Ears Park");
  });

  it("falls back to plain dates, the collectionId and no links when lookups give nothing", async () => {
    routeRunQuery({
      bookingDates: [{ date: "2026-06-12", quantity: 1 }],
      geozones: [{ sk: "counter" }],
    });

    const params = await generateEmailParams(storedBooking({ activityType: "kayakRental", productDisplayName: undefined }));

    expect(params.booking).toMatchObject({
      arrivalDate: "2026-06-12",
      departureDate: "2026-06-12",
      accountBookingUrl: null,
      cancellationUrl: null,
      activityTypeLabel: "KayakRental",
      productName: "Lindsay's Loop - AM (2026-06-12)",
    });
    expect(params.location.parkName).toBe("bcparks_8");
    expect(params.customer).toEqual({ firstName: "", lastName: "", licensePlate: "", licensePlateRegion: "" });
  });

  it("uses the collectionId when the park lookup fails", async () => {
    runQuery.mockImplementation(async (query) => {
      if (query.TableName === "ref") throw new Error("throttled");
      return { items: BOOKING_DATES };
    });

    const params = await generateEmailParams(storedBooking());

    expect(params.location.parkName).toBe("bcparks_8");
  });

  it("returns null when the booking dates cannot be read", async () => {
    runQuery.mockRejectedValue(new Error("throttled"));

    await expect(generateEmailParams(storedBooking())).resolves.toBeNull();
  });
});

describe("formatBookingResponsePublic", () => {
  it("returns the public booking fields and date totals, without keys or owner identity", () => {
    const items = [
      { action: "Put", data: { Item: {
        pk: "booking::x", sk: "s", gsipk: "sub-1", schema: "booking", bookingId: "bk-1", sessionId: "sess-1",
        status: "in progress", startDate: "2026-06-12", endDate: "2026-06-13", userId: "sub-1",
        namedOccupant: { email: "jane@example.com" },
        reservationContext: { arrivalDate: "2026-06-12", departureDate: "2026-06-13", noShowTime: 5 },
      } } },
      { action: "Put", data: { Item: { schema: "bookingDate", quantity: 2 } } },
      { action: "Put", data: { Item: { schema: "bookingDate", quantity: 2 } } },
      { action: "Put", data: { Item: { schema: "bookingHold" } } },
      { action: "Update", data: {} },
    ];

    const res = formatBookingResponsePublic(items);

    expect(res).toMatchObject({
      bookingId: "bk-1",
      sessionId: "sess-1",
      status: "in progress",
      arrivalDate: "2026-06-12",
      departureDate: "2026-06-13",
      noShowTime: 5,
      totalDays: 2,
      totalInventory: 4,
    });
    expect(res).not.toHaveProperty("pk");
    expect(res).not.toHaveProperty("gsipk");
    expect(res).not.toHaveProperty("namedOccupant");
  });
});

describe("getExpiredBookings", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("queries the pending sparse index for sessions that expired before now", async () => {
    runQuery.mockResolvedValue({ items: [{ bookingId: "bk-1" }] });

    const res = await getExpiredBookings();

    expect(res).toEqual({ items: [{ bookingId: "bk-1" }] });
    const [query, , , paginated] = runQuery.mock.calls[0];
    expect(query.IndexName).toBe("gsi1");
    expect(query.ExpressionAttributeValues).toEqual({ ":isPending": { S: "PENDING" }, ":now": { N: String(NOW) } });
    expect(paginated).toBe(false);
  });
});
