"use strict";

// Capture what the handler builds so each test can inspect the OpenSearch request
const mockAddFilterTermsRule = jest.fn();
const mockSearch = jest.fn();
let mockOptions;
let mockQuery;

jest.mock("/opt/opensearch", () => ({
  OSQuery: jest.fn().mockImplementation((index, options) => {
    mockOptions = options;
    mockQuery = { query: { bool: {} }, addFilterTermsRule: mockAddFilterTermsRule, search: mockSearch };
    return mockQuery;
  }),
  OPENSEARCH_USER_INDEX_NAME: "user-index",
}));

jest.mock("/opt/base", () => ({
  sendResponse: jest.fn((status, data, message, error, context) => ({ status, data, message, error, context })),
  logger: { debug: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

const { handler } = require("../admin");

const search = (body) => handler({ httpMethod: "POST", body: JSON.stringify(body) }, {});

describe("Users admin search POST handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.mockResolvedValue({ body: { hits: { hits: [], total: { value: 0 }, max_score: null } } });
  });

  it("matches an email exactly or as a substring, without fuzzy matching", async () => {
    await search({ query: "Dave@Gmail.com" });

    const should = mockQuery.query.bool.must[0].bool.should;
    expect(should).toEqual([
      { term: { "email.keyword": { value: "Dave@Gmail.com", case_insensitive: true, boost: 10 } } },
      { wildcard: { "email.keyword": { value: "*Dave@Gmail.com*", case_insensitive: true } } },
    ]);
  });

  it("ranks a text search by match score", async () => {
    await search({ query: "dave@gmail.com" });

    expect(mockOptions.sortField).toBe("_score");
  });

  it("keeps fuzzy matching across name, phone and plate for a non-email search", async () => {
    await search({ query: "dave" });

    const should = mockQuery.query.bool.must[0].bool.should;
    expect(should[0].multi_match).toEqual(expect.objectContaining({ query: "dave", fuzziness: "AUTO" }));
    expect(should).toHaveLength(7);
    expect(mockOptions.sortField).toBe("_score");
  });

  it("lists newest users first when there is no search text", async () => {
    await search({});

    expect(mockOptions.sortField).toBe("createdAt");
    expect(mockQuery.query.bool.must).toBeUndefined();
  });

  it("keeps an exact filter lookup (sub) on the createdAt sort", async () => {
    await search({ "sub.keyword": "sub-1", size: 1 });

    expect(mockOptions.sortField).toBe("createdAt");
    expect(mockAddFilterTermsRule).toHaveBeenCalledWith({ "sub.keyword": "sub-1" }, true);
  });

  it("honours a sortField the caller asks for", async () => {
    await search({ query: "dave", sortField: "email.keyword", sortOrder: "asc" });

    expect(mockOptions).toEqual(expect.objectContaining({ sortField: "email.keyword", sortOrder: "asc" }));
  });
});
