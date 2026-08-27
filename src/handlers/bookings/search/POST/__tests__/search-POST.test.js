"use strict";

// Set up the spy functions to track what our handler passes to OpenSearch
const mockAddMatchQueryStringRule = jest.fn();
const mockAddFilterTermsRule = jest.fn();
const mockAddRangeQueryRule = jest.fn();
const mockAddExistsQueryRule = jest.fn();
const mockSearch = jest.fn();

// Mock the OpenSearch Layer
jest.mock("/opt/opensearch", () => ({
  OSQuery: jest.fn().mockImplementation(() => ({
    addMatchQueryStringRule: mockAddMatchQueryStringRule,
    addFilterTermsRule: mockAddFilterTermsRule,
    addRangeQueryRule: mockAddRangeQueryRule,
    addExistsQueryRule: mockAddExistsQueryRule,
    search: mockSearch,
    request: { some: "request" },
  })),
  OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: "test-index",
  nonKeyableTerms: [],
}));

// Mock the Base Layer (Utilities and Auth)
jest.mock("/opt/base", () => ({
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  },
  handleCORS: jest.fn(),
  checkAuthContext: jest.fn(),
  effectiveCollectionRole: jest.fn(),
  calculatePartySize: jest.fn(() => 4),
}));

const { handler } = require("../index");
const { checkAuthContext, effectiveCollectionRole, handleCORS } = require("/opt/base");

describe("Bookings Admin Search POST handler", () => {
  const fixedDate = 1784118177000;

  beforeEach(() => {
    jest.clearAllMocks();

    // Lock the date context so dynamic ISO strings produced by Date().toISOString() are 100% predictable
    jest.useFakeTimers();
    jest.setSystemTime(fixedDate);
    
    mockSearch.mockResolvedValue({
      body: {
        hits: {
          hits: [
            {
              _source: {
                bookingId: "booking_123",
                collectionId: "collection_123",
                activityType: "dayuse",
                activitySubType: "vehicleParking",
                status: "confirmed",
                bookingCompletionTime: 1781106147626,
                displayName: "Camping Day-use Pass - AM",
                endDate: "2026-06-10",
                facilityDisplayName: "Camping",
                geozoneDisplayName: "Garibaldi Park",
                namedOccupant: {
                  contactInfo: {
                    email: "test@example.com",
                    mobilePhone: "1231231234",
                  },
                  firstName: "John",
                  lastName: "Camper"
                },
                productDisplayName: "Camping Day-use Pass - AM",
                reservationContext: {
                  checkInTime: 1781100000000,
                  checkOutTime: 1781136000000,
                },
                timezone: "America/Vancouver",
                userId: "123-123-123-123-123",
              }
            }
          ]
        }
      }
    });

    handleCORS.mockReturnValue(null);
    checkAuthContext.mockReturnValue({ permissions: { superadmin: "superadmin" } });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("handles CORS preflight requests correctly", async () => {
    handleCORS.mockReturnValue({ status: 200 }); // Simulate an OPTIONS request intercept
    const result = await handler({ httpMethod: "OPTIONS" }, {});
    expect(result.status).toBe(200);
  });

  it("triggers a fuzzy search across all fields when text is provided", async () => {
    const event = {
      body: JSON.stringify({ text: "Camping" })
    };
    
    await handler(event, {});
    expect(mockAddMatchQueryStringRule).toHaveBeenCalledWith("Camping");
  });

  it("filters by exact email using the .keyword field", async () => {
    const event = {
      body: JSON.stringify({ email: "test@example.com" })
    };
    
    await handler(event, {});
    expect(mockAddFilterTermsRule).toHaveBeenCalledWith(
      expect.objectContaining({
        'namedOccupant.contactInfo.email.keyword': "test@example.com"
      })
    );
  });

  it("adds range queries checking for future check-in times and confirmed filter for 'reserved' status", async () => {
    const event = {
      body: JSON.stringify({ checkinStatus: "reserved" })
    };
    
    await handler(event, {});

    const expectedNow = fixedDate;
    const expectedFuture = 4102444799000;

    expect(mockAddRangeQueryRule).toHaveBeenCalledWith(
      'reservationContext.checkInTime',
      expectedNow,
      expectedFuture,
      false,
      true
    );
    expect(mockAddFilterTermsRule).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed" })
    );
  });

  it("adds overlapping timeline checks and confirmed filter for 'active' status", async () => {
    const event = {
      body: JSON.stringify({ checkinStatus: "active" })
    };
    
    await handler(event, {});

    const expectedNow = fixedDate;
    const expectedPast = 0; // 1970-01-01
    const expectedFuture = 4102444799000; // 2099-12-31

    // Verify check-in happened in past (or now)
    expect(mockAddRangeQueryRule).toHaveBeenCalledWith(
      'reservationContext.checkInTime',
      expectedPast,
      expectedNow,
      true,
      true
    );
    // Verify check-out resides in future (or now)
    expect(mockAddRangeQueryRule).toHaveBeenCalledWith(
      'reservationContext.checkOutTime',
      expectedNow,
      expectedFuture,
      true,
      true
    );
    expect(mockAddFilterTermsRule).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed" })
    );
  });

  it("translates startDate and endDate into a valid range query", async () => {
    const event = {
      body: JSON.stringify({ 
        startDate: "2026-06-01",
        endDate: "2026-06-30" 
      })
    };
    
    await handler(event, {});
    expect(mockAddRangeQueryRule).toHaveBeenCalledWith(
      'startDate', 
      '2026-06-01', 
      '2026-06-30'
    );
  });

  it("returns raw, unpruned data directly from OpenSearch for superadmins", async () => {
    checkAuthContext.mockReturnValue({ permissions: { superadmin: "superadmin" } });
    
    const event = {
      body: JSON.stringify({ text: "give me everything" })
    };
    
    const result = await handler(event, {});
    const hits = result.data.hits;
    
    expect(result.status).toBe(200);
    expect(hits[0]).toHaveProperty("namedOccupant.contactInfo.mobilePhone");
    expect(hits[0]).toHaveProperty("namedOccupant.contactInfo.email", "test@example.com");
  });

  it("prunes sensitive response data for non-superadmin staff", async () => {
    checkAuthContext.mockReturnValue({
      permissions: { superadmin: "not-superadmin" }
    });
    effectiveCollectionRole.mockReturnValue("staff");
    
    const event = {
      body: JSON.stringify({ text: "test" })
    };
    
    const result = await handler(event, {});
    const hits = result.data.hits;

    expect(result.status).toBe(200);
    // The namedOccupant object should have been flattened/removed in the .map()
    expect(hits[0]).not.toHaveProperty("namedOccupant.mobilePhone");
    // But core verification fields should survive
    expect(hits[0]).toHaveProperty("email", "test@example.com");
    expect(hits[0]).toHaveProperty("bookingId", "booking_123");
  });

  it("keeps the activity sub type on the pruned response so pass cards can label it", async () => {
    checkAuthContext.mockReturnValue({
      permissions: { superadmin: "not-superadmin" }
    });
    effectiveCollectionRole.mockReturnValue("staff");

    const event = {
      body: JSON.stringify({ text: "test" })
    };

    const result = await handler(event, {});
    const hits = result.data.hits;

    // Park operators are not superadmins, so they only ever see the pruned
    // shape. Dropping activitySubType here left the Sales pass card with an
    // empty sub type badge (Ref #336).
    expect(hits[0]).toHaveProperty("activityType", "dayuse");
    expect(hits[0]).toHaveProperty("activitySubType", "vehicleParking");
  });

  it("filters out hits completely if the user has no recognized role for that collection", async () => {
    checkAuthContext.mockReturnValue({
      permissions: { superadmin: "not-superadmin" }
    });
    effectiveCollectionRole.mockReturnValue(null); // User has no role for "collection_123"
    
    const event = {
      body: JSON.stringify({ text: "test" })
    };
    
    const result = await handler(event, {});
    
    // The array should be empty because the filter() stripped it out
    expect(result.data.hits).toHaveLength(0);
  });

  it("catches OpenSearch exceptions and returns a formatted error response", async () => {
    const mockError = { code: 503, msg: "OpenSearch cluster unavailable", error: "Timeout" };
    mockSearch.mockRejectedValue(mockError); // Force a failure

    const event = {
      body: JSON.stringify({ text: "test" })
    };
    
    const result = await handler(event, {});
    
    expect(result.status).toBe(503);
    expect(result.message).toBe("OpenSearch cluster unavailable");
  });
});
