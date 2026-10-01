"use strict";

jest.mock("/opt/base", () => ({
  ...jest.requireActual("/opt/base"),
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { runQuery } = require("/opt/dynamodb");

describe("runQuery page params from a query string", () => {
  let send;

  beforeEach(() => {
    send = jest.spyOn(DynamoDBClient.prototype, "send").mockResolvedValue({ Items: [] });
  });

  afterEach(() => jest.restoreAllMocks());

  it("parses a string limit and a JSON lastEvaluatedKey", async () => {
    const key = { pk: { S: "activity::bcparks_7" }, sk: { S: "frontcountryCamp::1" } };
    await runQuery({ TableName: "t" }, "25", JSON.stringify(key));
    const input = send.mock.calls[0][0].input;
    expect(input.Limit).toBe(25);
    expect(input.ExclusiveStartKey).toEqual(key);
  });

  it.each([
    ["abc", null, "limit must be a positive integer"],
    ["0", null, "limit must be a positive integer"],
    [null, "not-json", "lastEvaluatedKey must be valid JSON"],
    [null, "42", "lastEvaluatedKey must be a JSON object"],
  ])("rejects limit=%p lastEvaluatedKey=%p with a 400", async (limit, key, message) => {
    await expect(runQuery({ TableName: "t" }, limit, key)).rejects.toMatchObject({ code: 400, message });
    expect(send).not.toHaveBeenCalled();
  });
});
