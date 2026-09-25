"use strict";

jest.mock("/opt/base", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { batchTransactData } = require("/opt/dynamodb");

const cancelled = (...codes) => Object.assign(new Error("Transaction cancelled"), {
  name: "TransactionCanceledException",
  CancellationReasons: codes.map((Code) => ({ Code })),
});
const ok = { $metadata: { httpStatusCode: 200 } };

describe("batchTransactData on a transaction conflict", () => {
  let send;

  beforeEach(() => {
    send = jest.spyOn(DynamoDBClient.prototype, "send");
    jest.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => jest.restoreAllMocks());

  it("sends the transaction again and succeeds", async () => {
    send.mockRejectedValueOnce(cancelled("TransactionConflict", "None")).mockResolvedValueOnce(ok);
    await expect(batchTransactData([{ data: {} }])).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts", async () => {
    send.mockRejectedValue(cancelled("TransactionConflict", "None"));
    await expect(batchTransactData([{ data: {} }])).rejects.toMatchObject({ name: "TransactionCanceledException" });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("does not retry when a condition failed", async () => {
    send.mockRejectedValue(cancelled("TransactionConflict", "ConditionalCheckFailed"));
    await expect(batchTransactData([{ data: {} }])).rejects.toThrow("Transaction cancelled");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
