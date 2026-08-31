"use strict";

// The bookings table doesn't reliably store the park image or the pass
// sub-type, so getBookingsByUserId fills both in from reference data.

const mockRunQuery = jest.fn();
const mockGetActivitiesByCollectionId = jest.fn();

jest.mock("/opt/dynamodb", () => ({
  getOneByGlobalId: jest.fn(),
  marshall: jest.fn((v) => v),
  runQuery: (...args) => mockRunQuery(...args),
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
  getActivitiesByCollectionId: (...args) => mockGetActivitiesByCollectionId(...args),
}));

const { getBookingsByUserId } = require("../methods");

describe("getBookingsByUserId enrichment", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // First call is the booking query, second is the geozone query.
    mockRunQuery
      .mockResolvedValueOnce({
        items: [{
          bookingId: "abc",
          collectionId: "bcparks_8",
          activityType: "dayuse",
          activityId: 1,
        }],
      })
      .mockResolvedValue({
        items: [{
          sk: "1",
          geozoneId: 1,
          displayName: "Golden Ears Park",
          imageUrl: "https://example.com/golden-ears.jpg",
        }],
      });

    mockGetActivitiesByCollectionId.mockResolvedValue({
      items: [{ activityType: "dayuse", activityId: 1, activitySubType: "vehicleParking" }],
    });
  });

  it("attaches the geozone name, image and pass sub-type", async () => {
    const result = await getBookingsByUserId("user-1", {});

    expect(result.items[0]).toEqual(expect.objectContaining({
      geozoneDisplayName: "Golden Ears Park",
      geozoneImageUrl: "https://example.com/golden-ears.jpg",
      activitySubType: "vehicleParking",
    }));
  });

  it("keeps a sub-type the booking already stores", async () => {
    mockRunQuery.mockReset();
    mockRunQuery
      .mockResolvedValueOnce({
        items: [{ bookingId: "abc", collectionId: "bcparks_8", activityType: "dayuse", activityId: 1, activitySubType: "trailUse" }],
      })
      .mockResolvedValue({ items: [] });

    const result = await getBookingsByUserId("user-1", {});

    expect(result.items[0].activitySubType).toBe("trailUse");
  });
});
