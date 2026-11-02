"use strict";

const mockClient = {
  search: jest.fn(),
  bulk: jest.fn(),
  cat: { indices: jest.fn() },
  indices: { exists: jest.fn(), create: jest.fn(), delete: jest.fn(), refresh: jest.fn() },
};
jest.mock("@opensearch-project/opensearch", () => ({ Client: jest.fn(() => mockClient) }));
jest.mock("@opensearch-project/opensearch/aws", () => ({ AwsSigv4Signer: jest.fn(() => ({})) }));
const mockCredentials = jest.fn();
jest.mock("@aws-sdk/credential-provider-node", () => ({ defaultProvider: jest.fn(() => mockCredentials) }));

const { Client } = require("@opensearch-project/opensearch");
const { AwsSigv4Signer } = require("@opensearch-project/opensearch/aws");
const os = require("/opt/opensearch");
const { OSQuery } = os;
const signerOptions = AwsSigv4Signer.mock.calls[0][0];

const sentRequest = () => mockClient.search.mock.calls[0][0];

beforeEach(() => {
  jest.clearAllMocks();
  mockClient.search.mockResolvedValue({ body: { hits: { hits: [] } } });
  mockClient.bulk.mockResolvedValue({ body: { errors: false } });
});

describe("OSQuery.search request", () => {
  it("sends only index, size and from when nothing else is set", async () => {
    await new OSQuery("idx").search();

    expect(sentRequest()).toEqual({ index: "idx", size: 10, from: 0 });
  });

  it.each([
    [0, 1],
    [-5, 1],
    [250, 100],
    [42, 42],
  ])("clamps size %p to %p", async (size, expected) => {
    await new OSQuery("idx", { size }).search();

    expect(sentRequest().size).toBe(expected);
  });

  it("returns the client response", async () => {
    mockClient.search.mockResolvedValue({ body: { hits: { total: 3 } } });

    await expect(new OSQuery("idx").search()).resolves.toEqual({ body: { hits: { total: 3 } } });
  });

  it("sorts on sortField, ascending by default", async () => {
    await new OSQuery("idx", { sortField: "name", from: 20 }).search();

    expect(sentRequest()).toEqual({
      index: "idx", size: 10, from: 20,
      body: { sort: [{ name: { order: "asc" } }] },
    });
  });

  it("honours a descending sortOrder and a later addSortRule replaces it", async () => {
    const q = new OSQuery("idx", { sortField: "name", sortOrder: "desc" });
    q.addSortRule("date", "desc");
    await q.search();

    expect(sentRequest().body.sort).toEqual([{ date: { order: "desc" } }]);
  });

  it("splits comma lists into a lower-cased terms filter", async () => {
    const q = new OSQuery("idx");
    q.addFilterTermsRule({ status: "Active,PENDING" });
    await q.search();

    expect(sentRequest().body.query).toEqual({
      bool: { filter: [{ terms: { status: ["active", "pending"] } }] },
    });
  });

  it("uses match for non-exact must and must_not terms, and terms for booleans", async () => {
    const q = new OSQuery("idx");
    q.addMustMatchTermsRule({ name: "Golden Ears", isVisible: true });
    q.addMustNotMatchTermsRule({ name: "Closed" });
    await q.search();

    expect(sentRequest().body.query).toEqual({
      bool: {
        must: [
          { match: { name: "golden ears" } },
          { terms: { isVisible: [true] } },
        ],
        must_not: [{ match: { name: "closed" } }],
      },
    });
  });

  it("splits exact must terms on commas", async () => {
    const q = new OSQuery("idx");
    q.addMustMatchTermsRule({ collectionId: "bcparks_1,bcparks_2" }, true);
    await q.search();

    expect(sentRequest().body.query.bool.must).toEqual([
      { terms: { collectionId: ["bcparks_1", "bcparks_2"] } },
    ]);
  });

  it("requires at least one should clause to match", async () => {
    const q = new OSQuery("idx");
    q.addShouldMatchTermsRule({ a: "x", b: "y" });
    await q.search();

    expect(sentRequest().body.query).toEqual({
      bool: {
        should: [{ match: { a: "x" } }, { match: { b: "y" } }],
        minimum_should_match: 1,
      },
    });
  });

  it("does not add minimum_should_match without should clauses", async () => {
    const q = new OSQuery("idx");
    q.addFilterTermsRule({ a: "x" });
    await q.search();

    expect(sentRequest().body.query.bool).not.toHaveProperty("minimum_should_match");
  });

  it("escapes reserved characters in a query string", async () => {
    const q = new OSQuery("idx");
    q.addMatchQueryStringRule('a-b (c) "d" e:f/g*');
    await q.search();

    expect(sentRequest().body.query.bool.must).toEqual([
      { query_string: { query: 'a\\-b \\(c\\) \\"d\\" e\\:f\\/g\\*' } },
    ]);
  });

  it("builds inclusive and exclusive range filters", async () => {
    const q = new OSQuery("idx");
    q.addRangeQueryRule("date", "2026-01-01", "2026-02-01");
    q.addRangeQueryRule("count", 1, 5, false, false);
    await q.search();

    expect(sentRequest().body.query.bool.filter).toEqual([
      { range: { date: { gte: "2026-01-01", lte: "2026-02-01" } } },
      { range: { count: { gt: 1, lt: 5 } } },
    ]);
  });

  it("puts exists under must and does-not-exist under must_not", async () => {
    const q = new OSQuery("idx");
    q.addExistsQueryRule("email");
    q.addExistsQueryRule("deletedAt", false);
    await q.search();

    expect(sentRequest().body.query.bool).toEqual({
      must: [{ exists: { field: "email" } }],
      must_not: [{ exists: { field: "deletedAt" } }],
    });
  });

  it("turns a bbox option into a geo_bounding_box filter on the geo point field", async () => {
    await new OSQuery("idx", {
      bbox: [[-123.4, 48.5], [-123.3, 48.4]],
      geoPointFieldName: "coords",
    }).search();

    expect(sentRequest().body.query).toEqual({
      bool: {
        filter: {
          geo_bounding_box: {
            coords: {
              top_left: { lat: 48.5, lon: -123.4 },
              bottom_right: { lat: 48.4, lon: -123.3 },
            },
          },
        },
      },
    });
  });

  it.each([
    ["not an array", "x"],
    ["one corner", [[1, 2]]],
    ["a corner that is not a pair", [[1, 2], [3]]],
    ["a corner that is not an array", [[1, 2], 3]],
  ])("ignores a malformed bbox: %s", async (_label, bbox) => {
    await new OSQuery("idx", { bbox }).search();

    expect(sentRequest()).not.toHaveProperty("body");
  });

  it("sends the pipeline given in options or set later", async () => {
    const q = new OSQuery("idx", { pipeline: "first" });
    q.updateSearchPipeline("second");
    await q.search();

    expect(sentRequest().body).toEqual({ search_pipeline: "second" });
  });

  it("collapses on collapseField", async () => {
    await new OSQuery("idx", { collapseField: "userId" }).search();

    expect(sentRequest().body).toEqual({ collapse: { field: "userId" } });
  });

  it("adds term suggesters with defaults and overrides", async () => {
    const q = new OSQuery("idx");
    q.addTermSuggester("goldn");
    q.addTermSuggester("ears", { field: "name", name: "n", size: 2, suggestMode: "always" });
    await q.search();

    expect(sentRequest().body.suggest).toEqual({
      "searchTerms-corrections": {
        text: "goldn",
        term: { field: "searchTerms", size: 5, suggest_mode: "missing" },
      },
      n: { text: "ears", term: { field: "name", size: 2, suggest_mode: "always" } },
    });
  });

  it("adds a fuzzy match with defaults", async () => {
    const q = new OSQuery("idx");
    q.addFuzzyMatchRule("name", "goldn");
    await q.search();

    expect(sentRequest().body.query.bool.must).toEqual([
      { match: { name: { query: "goldn", fuzziness: "AUTO", prefix_length: 0, max_expansions: 50 } } },
    ]);
  });

  it.each([
    [{ maxExpansions: 10000, prefixLength: -3 }, 50, 0],
    [{ maxExpansions: 0, prefixLength: 99 }, 50, 20],
    [{ maxExpansions: -4, prefixLength: "3" }, 1, 3],
    [{ maxExpansions: "abc", prefixLength: "abc" }, 50, 0],
  ])("clamps caller fuzzy options %p", async (options, maxExpansions, prefixLength) => {
    const q = new OSQuery("idx");
    q.addFuzzyMatchRule("name", "x", { ...options, fuzziness: 1 });
    await q.search();

    expect(sentRequest().body.query.bool.must[0].match.name).toEqual({
      query: "x", fuzziness: 1, prefix_length: prefixLength, max_expansions: maxExpansions,
    });
  });

  it("builds a phrase prefix query by default and a lower-cased prefix query otherwise", async () => {
    const q = new OSQuery("idx");
    q.addPrefixQuery("name", "Gold");
    q.addPrefixQuery("code", "BCP", { usePhrase: false, boost: 2 });
    await q.search();

    expect(sentRequest().body.query.bool.must).toEqual([
      { match_phrase_prefix: { name: { query: "Gold", max_expansions: 50, boost: 1 } } },
      { prefix: { code: { value: "bcp", boost: 2 } } },
    ]);
  });
});

describe("index helpers", () => {
  it("builds a document id from pk and sk", () => {
    expect(os.buildIdFromPkSk("product::1", "base")).toBe("product::1#base");
  });

  it("checks, lists, creates and deletes indices through the client", async () => {
    mockClient.indices.exists.mockResolvedValue({ body: true });
    mockClient.cat.indices.mockResolvedValue({ body: [{ index: "a" }] });

    await expect(os.checkIndexExists("a")).resolves.toEqual({ body: true });
    await expect(os.checkIndex("b")).resolves.toEqual({ body: true });
    await expect(os.listIndices()).resolves.toEqual({ body: [{ index: "a" }] });
    await os.createIndex("c", { properties: { name: { type: "text" } } });
    await os.deleteIndex("d");

    expect(mockClient.indices.exists.mock.calls).toEqual([[{ index: "a" }], [{ index: "b" }]]);
    expect(mockClient.cat.indices).toHaveBeenCalledWith({ format: "json" });
    expect(mockClient.indices.create).toHaveBeenCalledWith({
      index: "c",
      body: { mappings: { properties: { name: { type: "text" } } } },
    });
    expect(mockClient.indices.delete).toHaveBeenCalledWith({ index: "d" });
  });

  it("rethrows a create failure", async () => {
    mockClient.indices.create.mockRejectedValueOnce(new Error("resource_already_exists"));

    await expect(os.createIndex("c")).rejects.toThrow("resource_already_exists");
  });
});

describe("bulkWriteDocuments", () => {
  const bodyOf = (call) => mockClient.bulk.mock.calls[call][0].body;

  it("upserts each document by default into the reference index", async () => {
    await os.bulkWriteDocuments([{ id: "a", n: 1 }, { id: "b", n: 2 }]);

    expect(bodyOf(0)).toEqual([
      { update: { _index: "reference-data-index", _id: "a" } },
      { doc: { id: "a", n: 1 }, doc_as_upsert: true },
      { update: { _index: "reference-data-index", _id: "b" } },
      { doc: { id: "b", n: 2 }, doc_as_upsert: true },
    ]);
    expect(mockClient.indices.refresh).toHaveBeenCalledWith({ index: "reference-data-index" });
  });

  it.each(["index", "create"])("sends the full document for %s", async (action) => {
    await os.bulkWriteDocuments([{ id: "a", n: 1 }], "users", action);

    expect(bodyOf(0)).toEqual([{ [action]: { _index: "users", _id: "a" } }, { id: "a", n: 1 }]);
  });

  it("sends only the action line for delete", async () => {
    await os.bulkWriteDocuments([{ id: "a" }], "users", "delete");

    expect(bodyOf(0)).toEqual([{ delete: { _index: "users", _id: "a" } }]);
  });

  it("splits more than 100 documents into separate bulk requests", async () => {
    const items = Array.from({ length: 205 }, (_, i) => ({ id: `d${i}` }));

    await os.bulkWriteDocuments(items, "idx", "delete");

    expect(mockClient.bulk.mock.calls.map((c) => c[0].body.length)).toEqual([100, 100, 5]);
    expect(bodyOf(2)[4]).toEqual({ delete: { _index: "idx", _id: "d204" } });
  });

  it("throws the item errors and stops when a bulk response reports errors", async () => {
    mockClient.bulk.mockResolvedValueOnce({ body: { errors: true, items: [{ update: { status: 400 } }] } });
    const items = Array.from({ length: 150 }, (_, i) => ({ id: `d${i}` }));

    const error = await os.bulkWriteDocuments(items, "idx").catch((e) => e);

    expect(JSON.parse(error)).toEqual([{ update: { status: 400 } }]);
    expect(mockClient.bulk).toHaveBeenCalledTimes(1);
    expect(mockClient.indices.refresh).not.toHaveBeenCalled();
  });
});

describe("client setup", () => {
  it("signs requests for es in ca-central-1 with the default credential chain", async () => {
    mockCredentials.mockResolvedValue({ accessKeyId: "AKIA", secretAccessKey: "s" });

    expect(signerOptions).toMatchObject({ region: "ca-central-1", service: "es" });
    await expect(signerOptions.getCredentials()).resolves.toEqual({ accessKeyId: "AKIA", secretAccessKey: "s" });
  });

  it("uses an unsigned client that accepts self-signed certs when offline", () => {
    process.env.IS_OFFLINE = "true";
    jest.isolateModules(() => require("/opt/opensearch"));
    delete process.env.IS_OFFLINE;

    expect(Client).toHaveBeenLastCalledWith({ node: "http://localhost:9200", ssl: { rejectUnauthorized: false } });
  });
});
