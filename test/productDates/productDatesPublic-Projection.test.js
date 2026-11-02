"use strict";

/**
 * product-dates GET public: single-date and range reads return the same projection.
 */
jest.mock("/opt/dynamodb", () => ({
  REFERENCE_DATA_TABLE_NAME: "test-table",
  runQuery: jest.fn(),
  getOne: jest.fn(),
  batchTransactData: jest.fn(),
  marshall: (item) => item,
}));

jest.mock("/opt/base", () => ({
  ...jest.requireActual("/opt/base"),
  requestIdentity: jest.fn(() => ({ authenticated: true })),
}));

jest.mock("../../src/handlers/products/methods", () => ({ getProductById: jest.fn() }));

const { runQuery } = require("/opt/dynamodb");
const { handler } = require("../../src/handlers/productDates/_productId/GET/public");
const { PUBLIC_PRODUCTDATE_PROJECTIONS } = require("../../src/handlers/productDates/configs");

const FULL_RECORD = {
  pk: "productDate::bcparks_999::dayuse::9::9",
  sk: "2026-09-05",
  collectionId: "bcparks_999",
  activityType: "dayuse",
  activityId: "9",
  productId: "9",
  date: "2026-09-05",
  displayName: "Day pass",
  reservationContext: { isDiscoverable: true },
  version: 1,
  schema: "productDate",
  adminNotes: "internal note",
  lastUpdatedBy: "someone",
};

// Applies the query's ProjectionExpression the way DynamoDB would
function applyProjection(query, record) {
  if (!query.ProjectionExpression) return record;
  const fields = query.ProjectionExpression.split(", ").map((name) => query.ExpressionAttributeNames[name]);
  return Object.fromEntries(fields.filter((f) => f in record).map((f) => [f, record[f]]));
}

function event(query) {
  return {
    httpMethod: "GET",
    pathParameters: { collectionId: "bcparks_999", activityType: "dayuse", activityId: "9", productId: "9" },
    queryStringParameters: query,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  runQuery.mockImplementation(async (query) => [applyProjection(query, FULL_RECORD)]);
});

describe("product-dates GET public projection", () => {
  it.each([
    ["single date", { date: "2026-09-05" }],
    ["range", { startDate: "2026-09-05", endDate: "2026-09-06" }],
  ])("returns only the public fields for a %s read", async (_name, query) => {
    const res = await handler(event(query), {});
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    const record = body.data[0];
    expect(Object.keys(record).sort()).toEqual(Object.keys(FULL_RECORD).filter((k) => PUBLIC_PRODUCTDATE_PROJECTIONS.includes(k)).sort());
    expect(record).not.toHaveProperty("adminNotes");
    expect(record).not.toHaveProperty("lastUpdatedBy");
    expect(runQuery.mock.calls[0][0].FilterExpression).toContain("#isDiscoverable");
  });
});
