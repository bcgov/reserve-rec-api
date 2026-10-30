"use strict";

const mockApiGwSend = jest.fn();
jest.mock("@aws-sdk/client-apigatewaymanagementapi", () => ({
  ...jest.requireActual("@aws-sdk/client-apigatewaymanagementapi"),
  ApiGatewayManagementApiClient: jest.fn(() => ({ send: (...args) => mockApiGwSend(...args) })),
}));
jest.mock("axios", () => ({ get: jest.fn() }));

const axios = require("axios");
const { PassThrough } = require("stream");
const { transports } = require("winston");
const { ApiGatewayManagementApiClient } = require("@aws-sdk/client-apigatewaymanagementapi");
const { marshall } = require("@aws-sdk/util-dynamodb");
const base = require("/opt/base");

const authEvent = (permissions, extra = {}) => ({
  requestContext: { authorizer: { principalId: "sub-1", permissions: JSON.stringify(permissions) } },
  ...extra,
});

describe("checkAuthContext", () => {
  afterEach(() => delete process.env.AWS_SAM_LOCAL);

  it("grants a local superadmin under SAM local", () => {
    process.env.AWS_SAM_LOCAL = "true";

    expect(base.checkAuthContext({}, "staff", "c1")).toEqual({
      sub: "local-dev",
      permissions: { superadmin: "superadmin" },
    });
  });

  it("lets a superadmin through without a collection permission", () => {
    const event = authEvent({ superadmin: "superadmin" }, { pathParameters: { collectionId: "c9" } });

    expect(base.checkAuthContext(event, "staff")).toEqual({
      sub: "sub-1",
      permissions: { superadmin: "superadmin" },
    });
  });

  it("takes the sub from Cognito claims when there is no principalId", () => {
    const event = { requestContext: { claims: { sub: "sub-2" } } };

    expect(base.checkAuthContext(event)).toEqual({ sub: "sub-2", permissions: {} });
  });

  it("refuses a collection the user has no permission for", () => {
    const event = authEvent({ c1: "staff" }, { pathParameters: { collectionId: "c2" } });

    expect(() => base.checkAuthContext(event)).toThrow(
      expect.objectContaining({ code: 403, message: "Unauthorized: User does not have access to this specific collection." })
    );
  });

  it("refuses the wrong tier on the collection", () => {
    const event = authEvent({ c1: "limited" }, { pathParameters: { collectionId: "c1" } });

    expect(() => base.checkAuthContext(event, "staff")).toThrow(expect.objectContaining({ code: 403 }));
  });

  it("accepts the required tier on the collection", () => {
    const event = authEvent({ c1: "staff" }, { pathParameters: { collectionId: "c1" } });

    expect(base.checkAuthContext(event, "staff")).toEqual({ sub: "sub-1", permissions: { c1: "staff" } });
  });

  it("prefers an explicit collectionId over the path parameter", () => {
    const event = authEvent({ c1: "staff" }, { pathParameters: { collectionId: "c2" } });

    expect(base.checkAuthContext(event, null, "c1").permissions).toEqual({ c1: "staff" });
  });

  it("without a collection, needs the tier in at least one collection", () => {
    expect(base.checkAuthContext(authEvent({ c1: "limited", c2: "staff" }), "staff").sub).toBe("sub-1");
    expect(() => base.checkAuthContext(authEvent({ c1: "limited" }), "staff")).toThrow(
      expect.objectContaining({ code: 403 })
    );
  });

  it("answers 401 when the permissions are not JSON", () => {
    const event = { requestContext: { authorizer: { principalId: "s", permissions: "{bad" } } };

    expect(() => base.checkAuthContext(event)).toThrow(
      expect.objectContaining({ code: 401, message: "Unauthorized - Invalid permissions format" })
    );
  });
});

describe("filterByRole", () => {
  const FILTERS = { default: ["adminNotes", "internal"], staff: ["internal"] };
  const row = { id: 1, adminNotes: "n", internal: "i" };

  it("returns everything to a superadmin", () => {
    expect(base.filterByRole(row, "superadmin", FILTERS)).toBe(row);
  });

  it("removes the fields listed for the role", () => {
    expect(base.filterByRole(row, "staff", FILTERS)).toEqual({ id: 1, adminNotes: "n" });
  });

  it("falls back to the default filter for an unknown or missing role", () => {
    expect(base.filterByRole(row, "visitor", FILTERS)).toEqual({ id: 1 });
    expect(base.filterByRole(row, undefined, FILTERS)).toEqual({ id: 1 });
  });

  it("filters each element of an array and leaves non-objects alone", () => {
    expect(base.filterByRole([row, null, "x"], "default", FILTERS)).toEqual([{ id: 1 }, null, "x"]);
  });
});

describe("handleCORS", () => {
  it("answers an OPTIONS preflight with 200", () => {
    const res = base.handleCORS({ httpMethod: "OPTIONS" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ code: 200, msg: "Success", data: {} });
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
  });

  it("returns null for other methods", () => {
    expect(base.handleCORS({ httpMethod: "GET" })).toBeNull();
  });
});

describe("date helpers", () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date("2026-07-01T12:00:00.000Z") }));
  afterEach(() => jest.useRealTimers());

  it("reports now in UTC by default or in a given zone", () => {
    expect(base.getNowISO()).toBe("2026-07-01T12:00:00.000Z");
    expect(base.getNowISO("America/Vancouver")).toBe("2026-07-01T05:00:00.000-07:00");
    expect(base.getNowEpoch()).toBe(Date.UTC(2026, 6, 1, 12));
  });

  it("converts between epoch millis and ISO", () => {
    const ms = Date.UTC(2026, 0, 15, 20, 30);

    expect(base.epochToISO(ms)).toBe("2026-01-15T12:30:00.000-08:00");
    expect(base.epochToISO(ms, "UTC")).toBe("2026-01-15T20:30:00.000Z");
    expect(base.isoToEpoch("2026-01-15T12:30:00.000-08:00")).toBe(ms);
  });

  it("reads a short date as midnight in Vancouver", () => {
    expect(base.buildDateTimeFromShortDate("2026-03-08").toISO()).toBe("2026-03-08T00:00:00.000-08:00");
  });

  it("lists every day of a range, inclusive, across a month end", () => {
    expect(base.buildDateRange("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02",
    ]);
    expect(base.buildDateRange("2026-03-02", "2026-03-01")).toEqual([]);
    expect(base.buildDateRange("2026-12-31", "2027-01-01", "LLL d")).toEqual(["Dec 31", "Jan 1"]);
  });
});

describe("httpGet", () => {
  beforeEach(() => axios.get.mockReset());

  it("sends JSON headers and URI-encodes the url", async () => {
    axios.get.mockResolvedValue({ data: [1] });

    await expect(base.httpGet("https://x.test/a b")).resolves.toEqual({ data: [1] });
    expect(axios.get).toHaveBeenCalledWith("https://x.test/a%20b", {
      headers: { "Content-Type": "application/json", Authorization: "None", Accept: "application/json" },
    });
  });

  it("adds params, and caller headers cannot override the fixed ones", async () => {
    axios.get.mockResolvedValue({});

    await base.httpGet("https://x.test", { page: 2 }, { "x-api-key": "k", Accept: "text/html" });

    expect(axios.get).toHaveBeenCalledWith("https://x.test", {
      params: { page: 2 },
      headers: { "x-api-key": "k", "Content-Type": "application/json", Authorization: "None", Accept: "application/json" },
    });
  });

  it("rethrows a request failure", async () => {
    axios.get.mockRejectedValue(new Error("ECONNRESET"));

    await expect(base.httpGet("https://x.test")).rejects.toThrow("ECONNRESET");
  });
});

describe("sendMessage", () => {
  beforeEach(() => mockApiGwSend.mockReset());

  it("posts the message to the connection on the stage endpoint", async () => {
    mockApiGwSend.mockResolvedValue({});

    await base.sendMessage("conn-1", "https://ws.test", "prod", { hello: 1 });

    expect(ApiGatewayManagementApiClient).toHaveBeenLastCalledWith({ endpoint: "https://ws.test/prod" });
    const [[command]] = mockApiGwSend.mock.calls;
    expect(command.constructor.name).toBe("PostToConnectionCommand");
    expect(command.input).toEqual({ ConnectionId: "conn-1", Data: JSON.stringify({ message: { hello: 1 } }) });
  });

  it("does not throw when the connection is gone", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockApiGwSend.mockRejectedValue(Object.assign(new Error("Gone"), { name: "GoneException" }));

    await expect(base.sendMessage("conn-1", "https://ws.test", "prod", "x")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Failed to send message to connectionId: conn-1", expect.any(Error));
    console.error.mockRestore();
  });
});

describe("writeAuditLog", () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date("2026-07-01T12:00:00.000Z") }));
  afterEach(() => jest.useRealTimers());

  it("writes one audit record keyed by user and time, indexed by entity", async () => {
    const write = jest.fn().mockResolvedValue();

    await base.writeAuditLog("sub-1", "bk-9", "QR_VERIFY_SUCCESS", { park: "p", skip: undefined }, marshall, write, "audit");

    expect(write).toHaveBeenCalledWith([marshall({
      pk: "sub-1",
      sk: "2026-07-01T12:00:00.000Z",
      gsipk: "entity::bk-9",
      gsisk: "2026-07-01T12:00:00.000Z",
      operation: "QR_VERIFY_SUCCESS",
      metadata: { entityId: "bk-9", park: "p", timestamp: "2026-07-01T12:00:00.000Z" },
    })], 25, "audit");
  });

  it("swallows a write failure", async () => {
    const write = jest.fn().mockRejectedValue(new Error("down"));

    await expect(base.writeAuditLog("u", "e", "OP", undefined, marshall, write, "audit")).resolves.toBeUndefined();
  });
});

describe("calculatePartySize", () => {
  it.each([
    [{ adult: 2, senior: 1, youth: 3, child: 4 }, 10],
    [{ adult: 1 }, 1],
    [{}, 0],
    [null, 0],
  ])("%p -> %p", (party, expected) => {
    expect(base.calculatePartySize(party)).toBe(expected);
  });
});

describe("safeStringify", () => {
  it("projects errors to name, message and code", () => {
    const err = Object.assign(new Error("nope"), { code: 409, $response: { huge: true } });

    expect(JSON.parse(base.safeStringify({ err }))).toEqual({ err: { name: "Error", message: "nope", code: 409 } });
  });

  it("falls back to a 500 body when a value cannot be serialized", () => {
    jest.spyOn(base.logger, "error").mockImplementation(() => {});

    expect(JSON.parse(base.safeStringify({ n: 1n }))).toEqual({
      code: 500,
      data: null,
      msg: "Response could not be serialized",
      error: "Do not know how to serialize a BigInt",
    });
    base.logger.error.mockRestore();
  });
});

describe("logger output", () => {
  let out;
  let transport;
  beforeEach(() => {
    out = [];
    const stream = new PassThrough();
    stream.on("data", (chunk) => out.push(chunk.toString()));
    transport = new transports.Stream({ stream });
    base.logger.add(transport);
  });
  afterEach(() => base.logger.remove(transport));

  it("prints level, message and metadata", () => {
    base.logger.error("failed", { id: 3 });

    expect(out.join("")).toMatch(/^\S+ \[ERROR\]: failed \{"id":3\}\n$/);
  });

  it("prints an object message as JSON and a circular one without throwing", () => {
    const loop = {};
    loop.self = loop;

    base.logger.error({ a: 1 });
    base.logger.error(loop);

    expect(out[0]).toMatch(/\[ERROR\]: \{"a":1\}/);
    expect(out[1]).toMatch(/\[ERROR\]: \[object Object\]/);
  });
});
