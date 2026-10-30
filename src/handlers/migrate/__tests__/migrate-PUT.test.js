"use strict";

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data?.data || null;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  getOneByGlobalId: jest.fn(),
  marshall: jest.fn((value) => ({ S: String(value) })),
  TRANSACTIONAL_DATA_TABLE_NAME: "TransactionalDataTable",
}));

const MOCK_MIGRATE_ID = "4e707c5a-68f1-4728-b09e-2b5b691b86e6";
const NOW = 1792612298989; // Mock timestamp

const { handler } = require("../PUT/public");
const { batchTransactData, getOneByGlobalId, TRANSACTIONAL_DATA_TABLE_NAME } = require("/opt/dynamodb");

function makeEvent({ migrateId = MOCK_MIGRATE_ID } = {}) {
  return {
    httpMethod: "PUT",
    pathParameters: migrateId ? { migrateId } : null,
  };
}

const baseMigrateHold = {
  pk: "migrateHold",
  sk: "bcsc_12345",
  status: "pending",
  holdExpiry: NOW + 3600000, // Expires 1 hour in the future
  globalId: "rand-9876",
  oldParksSub: "abcd-1234",
  newBcscUsername: "bcsc_12345"

};

describe("PUT Migrate handler", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOneByGlobalId.mockResolvedValue({ ...baseMigrateHold });
    batchTransactData.mockResolvedValue({});

    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns 400 when migrateId path parameter is missing", async () => {
    const event = makeEvent({ migrateId: null });
    const result = await handler(event, {});

    expect(result.status).toBe(400);
    expect(result.message).toBe("A valid migrateId is required");
    expect(getOneByGlobalId).not.toHaveBeenCalled();
  });

  it("returns 400 when migrateId is not a UUID", async () => {
    const result = await handler(makeEvent({ migrateId: 'not-a-uuid' }), {});

    expect(result.status).toBe(400);
    expect(result.message).toBe("A valid migrateId is required");
    expect(getOneByGlobalId).not.toHaveBeenCalled();
  });

  it("returns 404 when migration hold record is not found", async () => {
    getOneByGlobalId.mockResolvedValue(null);

    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(404);
    expect(result.message).toContain("Migration not initialized");
    expect(getOneByGlobalId).toHaveBeenCalledWith(MOCK_MIGRATE_ID, TRANSACTIONAL_DATA_TABLE_NAME);
  });

  it("returns 410 when migration hold window has expired", async () => {
    getOneByGlobalId.mockResolvedValue({
      ...baseMigrateHold,
      holdExpiry: NOW - 1000, // Expired 1 second ago
    });

    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(410);
    expect(result.message).toContain("Migration window has expired");
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it("returns 404 when the indexed record is not a valid migration hold", async () => {
    getOneByGlobalId.mockResolvedValue({
      ...baseMigrateHold,
      pk: 'booking',
    });

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(404);
    expect(result.message).toContain("Migration request is invalid");
  });

  it("returns 409 when a migration is already being processed", async () => {
    getOneByGlobalId.mockResolvedValue({
      ...baseMigrateHold,
      status: "processing",
    });

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(409);
    expect(result.message).toContain("can no longer be confirmed");
  });

  it("returns 410 when the migration expiry is missing", async () => {
    getOneByGlobalId.mockResolvedValue({
      ...baseMigrateHold,
      holdExpiry: undefined,
    });

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(410);
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it("returns success when migration is already completed", async () => {
    getOneByGlobalId.mockResolvedValue({
      ...baseMigrateHold,
      status: "completed",
    });

    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ status: "completed" });
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it("returns success when migration is already confirmed", async () => {
    getOneByGlobalId.mockResolvedValue({
      ...baseMigrateHold,
      status: "confirmed",
    });

    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ status: "confirmed" });
    expect(batchTransactData).not.toHaveBeenCalled();
  });

  it("successfully confirms migration when status is pending and within expiry window", async () => {
  batchTransactData.mockResolvedValue(true);

  const event = makeEvent({});
  const result = await handler(event, {});

  expect(result.status).toBe(200);
  expect(result.data).toEqual({ status: "confirmed" });

  expect(batchTransactData).toHaveBeenCalledWith([
    {
      action: "Update",
      data: {
        TableName: TRANSACTIONAL_DATA_TABLE_NAME,
        Key: {
          pk: { S: "migrateHold" },
          sk: { S: "bcsc_12345" },
        },
        UpdateExpression: "SET #status = :confirmed, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updatedAt": "updatedAt",
          "#holdExpiry": "holdExpiry",
        },
        ExpressionAttributeValues: {
          ":confirmed": { S: "confirmed" },
          ":updatedAt": { N: String(NOW) },
          ":pending": { S: "pending" },
          ":now": { N: String(NOW) },
        },
        ConditionExpression: "#status = :pending AND #holdExpiry > :now",
      },
    },
  ]);
});

  it("returns error response when batchTransactData fails", async () => {
    batchTransactData.mockRejectedValue({
      code: 500,
      message: "DynamoDB Transaction Failed",
    });

    const event = makeEvent({});
    const result = await handler(event, {});

    expect(result.status).toBe(500);
    expect(result.message).toBe("DynamoDB Transaction Failed");
  });

  it("returns success if a concurrent request already confirmed the migration", async () => {
    batchTransactData.mockRejectedValue({
      name: "TransactionCanceledException",
    });
    getOneByGlobalId
      .mockResolvedValueOnce({ ...baseMigrateHold })
      .mockResolvedValueOnce({ ...baseMigrateHold, status: "confirmed" });

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(200);
    expect(result.data).toEqual({ status: "confirmed" });
  });

  it("returns 410 if the hold expires during a concurrent confirmation", async () => {
    batchTransactData.mockRejectedValue({
      name: "TransactionCanceledException",
    });
    getOneByGlobalId
      .mockResolvedValueOnce({ ...baseMigrateHold })
      .mockResolvedValueOnce({ ...baseMigrateHold, holdExpiry: NOW - 1 });

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(410);
    expect(result.message).toContain("Migration window has expired");
  });

  it("returns 409 when a concurrent update did not confirm or expire the hold", async () => {
    batchTransactData.mockRejectedValue({
      name: "TransactionCanceledException",
    });
    getOneByGlobalId
      .mockResolvedValueOnce({ ...baseMigrateHold })
      .mockResolvedValueOnce({ ...baseMigrateHold, status: "pending" });

    const result = await handler(makeEvent({}), {});

    expect(result.status).toBe(409);
    expect(result.message).toContain("Migration could not be confirmed");
  });
});
