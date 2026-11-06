"use strict";

// Set up the spy functions to track what our handler passes to OpenSearch
const mockAddMatchQueryStringRule = jest.fn();
const mockAddFilterTermsRule = jest.fn();
const mockAddRangeQueryRule = jest.fn();
const mockAddExistsQueryRule = jest.fn();
const mockSearch = jest.fn();
// The raw query body the handler can push clauses into directly
let mockQuery = {};

// Mock the OpenSearch Layer
jest.mock("/opt/opensearch", () => ({
  OSQuery: jest.fn().mockImplementation(() => ({
    addMatchQueryStringRule: mockAddMatchQueryStringRule,
    addFilterTermsRule: mockAddFilterTermsRule,
    addRangeQueryRule: mockAddRangeQueryRule,
    addExistsQueryRule: mockAddExistsQueryRule,
    search: mockSearch,
    request: { some: "request" },
    query: mockQuery,
  })),
  OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME: "test-index",
  nonKeyableTerms: [],
  escapeOpenSearchQuery: (s) => s.replace(/-/g, "\\-"),
}));

// Mock the Base Layer (Utilities and Auth)
jest.mock("/opt/base", () => ({
  requestIdentity: jest.fn(() => ({})),
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
  meetsTier: jest.requireActual("../../../../../layers/base/base").meetsTier,
  calculatePartySize: jest.fn(() => 4),
}));

const { handler } = require("../index");
const { checkAuthContext, effectiveCollectionRole, handleCORS } = require("/opt/base");

describe("Bookings Admin Search POST handler", () => {
  const fixedDate = 1784118177000;

  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = {};

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

  const textShould = () => mockQuery.bool.must[0].bool.should;

  it("matches a confirmation code prefix, all typed terms, or part of a name", async () => {
    await handler({ body: JSON.stringify({ text: "8b29" }) }, {});

    expect(mockAddMatchQueryStringRule).not.toHaveBeenCalled();
    expect(mockQuery.bool.must[0].bool.minimum_should_match).toBe(1);
    expect(textShould()).toEqual([
      { prefix: { bookingId: { value: "8b29", case_insensitive: true, boost: 10 } } },
      { prefix: { "bookingId.keyword": { value: "8b29", case_insensitive: true, boost: 10 } } },
      { query_string: { query: "8b29", default_operator: "AND", type: "cross_fields" } },
      { wildcard: { "namedOccupant.firstName.keyword": { value: "*8b29*", case_insensitive: true } } },
      { wildcard: { "namedOccupant.lastName.keyword": { value: "*8b29*", case_insensitive: true } } },
    ]);
  });

  it("escapes query syntax in the all-fields match but keeps the raw code for the prefix", async () => {
    await handler({ body: JSON.stringify({ text: "8b297302-e9" }) }, {});

    expect(textShould()[0].prefix.bookingId.value).toBe("8b297302-e9");
    expect(textShould()[2].query_string.query).toBe("8b297302\\-e9");
  });

  it("treats typed * ? \\ as literal characters in the name match", async () => {
    await handler({ body: JSON.stringify({ text: "j*o?\\" }) }, {});

    expect(textShould()[3].wildcard["namedOccupant.firstName.keyword"].value).toBe("*j\\*o\\?\\\\*");
  });

  it("matches an email exactly or as a substring, and nothing else", async () => {
    await handler({ body: JSON.stringify({ text: "John@Example.com" }) }, {});

    expect(textShould()).toEqual([
      { term: { "namedOccupant.contactInfo.email.keyword": { value: "John@Example.com", case_insensitive: true, boost: 10 } } },
      { wildcard: { "namedOccupant.contactInfo.email.keyword": { value: "*John@Example.com*", case_insensitive: true } } },
    ]);
  });

  it("adds no text clause when no text is provided", async () => {
    await handler({ body: JSON.stringify({}) }, {});

    expect(mockQuery.bool?.must).toBeUndefined();
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

  it("filters on the userId keyword subfield and collapses to one hit per customer", async () => {
    const { OSQuery } = require("/opt/opensearch");
    const event = {
      body: JSON.stringify({ userIds: ["sub-one", "sub-two"], size: 2 })
    };

    await handler(event, {});

    expect(mockAddFilterTermsRule).toHaveBeenCalledWith(
      expect.objectContaining({ "userId.keyword": "sub-one,sub-two" })
    );
    expect(OSQuery).toHaveBeenCalledWith(
      "test-index",
      expect.objectContaining({ collapseField: "userId.keyword" })
    );
  });

  it("scopes a userIds search to the caller's collections for non-superadmins", async () => {
    checkAuthContext.mockReturnValue({
      permissions: { collection_a: "staff", collection_b: "limited", collection_c: "default" },
    });
    const event = {
      body: JSON.stringify({ userIds: ["sub-one"], checkinStatus: "current" })
    };

    await handler(event, {});

    // Exact values, not lowercased, so mixed-case collection ids still match
    expect(mockQuery.bool.filter).toContainEqual({
      terms: { collectionId: ["collection_a", "collection_b"] },
    });
    expect(mockAddFilterTermsRule).toHaveBeenCalledWith(
      expect.not.objectContaining({ collectionId: expect.anything() })
    );
  });

  it("keeps collection ids exactly as they are", async () => {
    checkAuthContext.mockReturnValue({ permissions: { BCParks_Mixed: "staff" } });
    const event = {
      body: JSON.stringify({ userIds: ["sub-one"], checkinStatus: "current" })
    };

    await handler(event, {});

    expect(mockQuery.bool.filter).toContainEqual({
      terms: { collectionId: ["BCParks_Mixed"] },
    });
  });

  it("returns no results for an empty userIds list without searching", async () => {
    const event = {
      body: JSON.stringify({ userIds: [], checkinStatus: "current" })
    };

    const result = await handler(event, {});

    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(result.data.hits).toEqual([]);
  });

  it("does not scope a userIds search by collection for superadmins", async () => {
    checkAuthContext.mockReturnValue({ permissions: { superadmin: "superadmin" } });
    const event = {
      body: JSON.stringify({ userIds: ["sub-one"], checkinStatus: "current" })
    };

    await handler(event, {});

    expect(mockQuery.bool?.filter || []).not.toContainEqual(
      expect.objectContaining({ terms: expect.objectContaining({ collectionId: expect.anything() }) })
    );
  });

  it("does not collapse results when no userIds are supplied", async () => {
    const { OSQuery } = require("/opt/opensearch");
    const event = {
      body: JSON.stringify({ text: "test" })
    };

    await handler(event, {});

    expect(OSQuery).toHaveBeenCalledWith(
      "test-index",
      expect.objectContaining({ collapseField: null })
    );
  });

  it("treats 'current' status as any confirmed booking that has not checked out yet", async () => {
    const event = {
      body: JSON.stringify({ checkinStatus: "current" })
    };

    await handler(event, {});

    expect(mockAddRangeQueryRule).toHaveBeenCalledWith(
      'reservationContext.checkOutTime',
      fixedDate,
      4102444799000,
      true,
      true
    );
    expect(mockAddFilterTermsRule).toHaveBeenCalledWith(
      expect.objectContaining({ status: "confirmed" })
    );
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
