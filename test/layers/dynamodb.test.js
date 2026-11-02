"use strict";

const mockSend = jest.fn();
jest.mock("@aws-sdk/client-dynamodb", () => ({
  ...jest.requireActual("@aws-sdk/client-dynamodb"),
  DynamoDBClient: jest.fn(() => ({ send: (...args) => mockSend(...args) })),
}));

const { marshall } = require("@aws-sdk/util-dynamodb");
const db = require("/opt/dynamodb");

const sent = () => mockSend.mock.calls.map(([command]) => [command.constructor.name, command.input]);
const items = (...objs) => objs.map((o) => marshall(o));

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockRejectedValue(new Error("unexpected DynamoDB call"));
});

describe("getOne", () => {
  it("returns the unmarshalled item for the key", async () => {
    mockSend.mockResolvedValue({ Item: marshall({ pk: "a", sk: "b", n: 3 }) });

    await expect(db.getOne("a", "b", "t")).resolves.toEqual({ pk: "a", sk: "b", n: 3 });
    expect(sent()).toEqual([["GetItemCommand", { TableName: "t", Key: { pk: { S: "a" }, sk: { S: "b" } } }]]);
  });

  it("returns null when the item is missing", async () => {
    mockSend.mockResolvedValue({});

    await expect(db.getOne("a", "b")).resolves.toBeNull();
    expect(mockSend.mock.calls[0][0].input.TableName).toBe("reference-data");
  });
});

describe("getOneByGlobalId", () => {
  it("queries the globalId index and returns the first item", async () => {
    mockSend.mockResolvedValue({ Items: items({ pk: "x", globalId: "g1" }, { pk: "y", globalId: "g1" }) });

    await expect(db.getOneByGlobalId("g1")).resolves.toEqual({ pk: "x", globalId: "g1" });
    expect(sent()).toEqual([["QueryCommand", {
      TableName: "reference-data",
      IndexName: "globalId-index",
      KeyConditionExpression: "#globalId = :globalId",
      ExpressionAttributeValues: { ":globalId": { S: "g1" } },
      ExpressionAttributeNames: { "#globalId": "globalId" },
    }]]);
  });

  it("returns null when nothing matches", async () => {
    mockSend.mockResolvedValue({ Items: [] });

    await expect(db.getOneByGlobalId("nope", "t", "gid", "ix")).resolves.toBeNull();
  });
});

describe("getByGSI", () => {
  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => console.log.mockRestore());

  it("queries the partition key alone without a sort condition", async () => {
    mockSend.mockResolvedValue({ Items: items({ pk: "p" }) });

    const res = await db.getByGSI("gsipk", "policy::x", "t", "ix");

    expect(res.items).toEqual([{ pk: "p" }]);
    expect(sent()[0][1]).toEqual({
      TableName: "t",
      IndexName: "ix",
      KeyConditionExpression: "#gsipk = :gsipk",
      ExpressionAttributeValues: { ":gsipk": { S: "policy::x" } },
      ExpressionAttributeNames: { "#gsipk": "gsipk" },
    });
  });

  it.each([
    ["=", "#gsipk = :gsipk AND #sk = :sk"],
    ["equals", "#gsipk = :gsipk AND #sk = :sk"],
    ["begins_with", "#gsipk = :gsipk AND begins_with(#sk, :sk)"],
    ["<", "#gsipk = :gsipk AND #sk < :sk"],
    ["lessThan", "#gsipk = :gsipk AND #sk < :sk"],
    ["<=", "#gsipk = :gsipk AND #sk <= :sk"],
    ["lessThanOrEqual", "#gsipk = :gsipk AND #sk <= :sk"],
    [">", "#gsipk = :gsipk AND #sk > :sk"],
    ["greaterThan", "#gsipk = :gsipk AND #sk > :sk"],
    [">=", "#gsipk = :gsipk AND #sk >= :sk"],
    ["greaterThanOrEqual", "#gsipk = :gsipk AND #sk >= :sk"],
  ])("adds a %s sort key condition", async (operator, expression) => {
    mockSend.mockResolvedValue({ Items: [] });

    await db.getByGSI("gsipk", "v", "t", "ix", { operator, value: "2026" });

    const input = sent()[0][1];
    expect(input.KeyConditionExpression).toBe(expression);
    expect(input.ExpressionAttributeValues[":sk"]).toEqual({ S: "2026" });
    expect(input.ExpressionAttributeNames["#sk"]).toBe("sk");
  });

  it("adds a between condition on a named sort attribute", async () => {
    mockSend.mockResolvedValue({ Items: [] });

    await db.getByGSI("gsipk", "v", "t", "ix", { operator: "between", value: { start: 1, end: 9 }, attributeName: "date" });

    expect(sent()[0][1]).toMatchObject({
      KeyConditionExpression: "#gsipk = :gsipk AND #date BETWEEN :dateStart AND :dateEnd",
      ExpressionAttributeValues: { ":gsipk": { S: "v" }, ":dateStart": { N: "1" }, ":dateEnd": { N: "9" } },
      ExpressionAttributeNames: { "#gsipk": "gsipk", "#date": "date" },
    });
  });

  it("rejects an unknown operator without querying", async () => {
    await expect(db.getByGSI("gsipk", "v", "t", "ix", { operator: "like", value: "a" }))
      .rejects.toThrow("Unsupported sort key operator: like");
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("runQuery and runScan pagination", () => {
  it.each([["runQuery", "QueryCommand"], ["runScan", "ScanCommand"]])(
    "%s returns one page with its lastEvaluatedKey and Limit when paginated",
    async (fn, commandName) => {
      mockSend.mockResolvedValue({ Items: items({ pk: "a" }), LastEvaluatedKey: { pk: { S: "a" } } });

      const res = await db[fn]({ TableName: "t" }, "2", { pk: { S: "start" } });

      expect(res).toEqual({ items: [{ pk: "a" }], lastEvaluatedKey: { pk: { S: "a" } } });
      expect(sent()).toEqual([[commandName, { TableName: "t", Limit: 2, ExclusiveStartKey: { pk: { S: "start" } } }]]);
    }
  );

  it.each(["runQuery", "runScan"])("%s follows every page and sets no Limit when not paginated", async (fn) => {
    mockSend
      .mockResolvedValueOnce({ Items: items({ n: 1 }), LastEvaluatedKey: { k: { S: "1" } } })
      .mockResolvedValueOnce({ Items: items({ n: 2 }), LastEvaluatedKey: { k: { S: "2" } } })
      .mockResolvedValueOnce({ Items: items({ n: 3 }) });

    const res = await db[fn]({ TableName: "t" }, 5, null, false);

    expect(res).toEqual({ items: [{ n: 1 }, { n: 2 }, { n: 3 }] });
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[2][0].input).toEqual({ TableName: "t", ExclusiveStartKey: { k: { S: "2" } } });
  });

  it.each([
    ["a zero limit", 0, null, "limit must be a positive integer"],
    ["a fractional limit", "1.5", null, "limit must be a positive integer"],
    ["a non-JSON key", null, "{nope", "lastEvaluatedKey must be valid JSON"],
    ["an array key", null, "[1]", "lastEvaluatedKey must be a JSON object"],
    ["a number key", null, 5, "lastEvaluatedKey must be a JSON object"],
  ])("runScan rejects %s with a 400", async (_label, limit, key, message) => {
    const error = await db.runScan({ TableName: "t" }, limit, key).catch((e) => e);

    expect(error).toMatchObject({ message, code: 400 });
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("incrementCounter", () => {
  const counterKey = (pk) => ({ pk: { S: pk }, sk: { S: "counter" } });

  it("adds one to an up-to-date counter and returns the new value", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: marshall({ pk: "geozone::bcparks_7", sk: "counter", counterValue: 4 }) })
      .mockResolvedValueOnce({ Count: 5 })
      .mockResolvedValueOnce({ Attributes: marshall({ counterValue: 5 }) });

    await expect(db.incrementCounter("geozone::bcparks_7")).resolves.toBe(5);
    expect(sent()).toEqual([
      ["GetItemCommand", { TableName: "reference-data", Key: counterKey("geozone::bcparks_7") }],
      ["QueryCommand", {
        TableName: "reference-data",
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: "geozone::bcparks_7" } },
        Select: "COUNT",
      }],
      ["UpdateItemCommand", {
        TableName: "reference-data",
        Key: counterKey("geozone::bcparks_7"),
        UpdateExpression: "ADD counterValue :counterValue",
        ExpressionAttributeValues: { ":counterValue": { N: "1" } },
        ReturnValues: "ALL_NEW",
      }],
    ]);
  });

  it("keys a typed counter on pk::types and counts by sort key prefix", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: marshall({ counterValue: 2 }) })
      .mockResolvedValueOnce({ Count: 2 })
      .mockResolvedValueOnce({ Attributes: marshall({ counterValue: 3 }) });

    await expect(db.incrementCounter("facility::bcparks_1", ["campground", "x"])).resolves.toBe(3);
    const calls = sent();
    expect(calls[0][1].Key).toEqual(counterKey("facility::bcparks_1::campground::x"));
    expect(calls[1][1]).toMatchObject({
      KeyConditionExpression: "pk = :pk AND begins_with (sk, :sk)",
      ExpressionAttributeValues: { ":pk": { S: "facility::bcparks_1" }, ":sk": { S: "campground::x" } },
    });
    expect(calls[2][1].Key).toEqual(counterKey("facility::bcparks_1::campground::x"));
  });

  it("resets a missing counter to the highest identifier, then increments it", async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 3 })
      .mockResolvedValueOnce({ Items: items({ sk: "1", identifier: 3 }, { sk: "2", identifier: 7 }, { sk: "counter", identifier: 99 }) })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: marshall({ counterValue: 7 }) })
      .mockResolvedValueOnce({ Count: 3 })
      .mockResolvedValueOnce({ Attributes: marshall({ counterValue: 8 }) });

    await expect(db.incrementCounter("geozone::bcparks_1")).resolves.toBe(8);
    const calls = sent();
    expect(calls.map(([name]) => name)).toEqual([
      "GetItemCommand", "QueryCommand", "QueryCommand", "UpdateItemCommand",
      "GetItemCommand", "QueryCommand", "UpdateItemCommand",
    ]);
    expect(calls[2][1]).toMatchObject({ KeyConditionExpression: "pk = :pk", ProjectionExpression: "identifier" });
    expect(calls[3][1]).toEqual({
      TableName: "reference-data",
      Key: counterKey("geozone::bcparks_1"),
      UpdateExpression: "SET counterValue = :initialValue",
      ExpressionAttributeValues: { ":initialValue": { N: "7" } },
      ReturnValues: "ALL_NEW",
    });
  });

  it("resets a typed counter that has fallen behind the stored items", async () => {
    mockSend
      .mockResolvedValueOnce({ Item: marshall({ counterValue: 1 }) })
      .mockResolvedValueOnce({ Count: 4 })
      .mockResolvedValueOnce({ Items: items({ identifier: 2 }, { identifier: 4 }) })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: marshall({ counterValue: 4 }) })
      .mockResolvedValueOnce({ Count: 4 })
      .mockResolvedValueOnce({ Attributes: marshall({ counterValue: 5 }) });

    await expect(db.incrementCounter("policy", ["booking"])).resolves.toBe(5);
    const reset = sent()[3][1];
    expect(reset.Key).toEqual(counterKey("policy::booking"));
    expect(reset.ExpressionAttributeValues).toEqual({ ":initialValue": { N: "4" } });
  });

  it("resets to zero when no items exist yet", async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 0 })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Item: marshall({ counterValue: 0 }) })
      .mockResolvedValueOnce({ Count: 1 })
      .mockResolvedValueOnce({ Attributes: marshall({ counterValue: 1 }) });

    await expect(db.incrementCounter("geozone::new")).resolves.toBe(1);
    expect(sent()[3][1].ExpressionAttributeValues).toEqual({ ":initialValue": { N: "0" } });
  });

  it("rethrows a DynamoDB failure", async () => {
    mockSend.mockRejectedValue(new Error("throttled"));

    await expect(db.incrementCounter("geozone::x")).rejects.toThrow("throttled");
  });

  it("rethrows a failure while resetting", async () => {
    mockSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Count: 0 })
      .mockRejectedValueOnce(new Error("query failed"));

    await expect(db.incrementCounter("geozone::x")).rejects.toThrow("query failed");
  });
});

describe("single-item writes", () => {
  it("deletes only an item that exists", async () => {
    mockSend.mockResolvedValue({});

    await db.deleteItem("a", "b", "t");

    expect(sent()).toEqual([["DeleteItemCommand", {
      TableName: "t",
      Key: { pk: { S: "a" }, sk: { S: "b" } },
      ConditionExpression: "attribute_exists(pk) AND attribute_exists(sk)",
    }]]);
  });

  it("rethrows a delete failure", async () => {
    mockSend.mockRejectedValue(new Error("ConditionalCheckFailedException"));

    await expect(db.deleteItem("a", "b")).rejects.toThrow("ConditionalCheckFailedException");
  });

  it("puts only an item that does not exist yet", async () => {
    mockSend.mockResolvedValue({});

    await db.putItem({ pk: "a", sk: "b", n: 1 }, "t");

    expect(sent()).toEqual([["PutItemCommand", {
      TableName: "t",
      Item: { pk: { S: "a" }, sk: { S: "b" }, n: { N: "1" } },
      ConditionExpression: "attribute_not_exists(pk) AND attribute_not_exists(sk)",
    }]]);
  });
});

describe("batch gets", () => {
  const replyWith = (err, res) => mockSend.mockImplementation((_command, cb) => cb(err, res));
  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => {}));
  afterEach(() => console.log.mockRestore());

  it("returns the unmarshalled items for the keys", async () => {
    replyWith(null, { Responses: { t: items({ pk: "a", sk: "1" }) } });

    await expect(db.batchGetData([{ pk: "a", sk: "1" }], "t")).resolves.toEqual([{ pk: "a", sk: "1" }]);
    expect(sent()).toEqual([["BatchGetItemCommand", {
      RequestItems: { t: { Keys: [{ pk: { S: "a" }, sk: { S: "1" } }] } },
    }]]);
  });

  it("attaches keys DynamoDB did not process", async () => {
    const left = [{ pk: { S: "b" }, sk: { S: "2" } }];
    replyWith(null, { Responses: { t: [] }, UnprocessedKeys: { t: { Keys: left } } });

    const data = await db.batchGetData([{ pk: "a", sk: "1" }, { pk: "b", sk: "2" }], "t");

    expect(data.unprocessedKeys).toEqual(left);
  });

  it("rejects with the client error", async () => {
    replyWith(new Error("ProvisionedThroughputExceeded"));

    await expect(db.batchGetData([{ pk: "a", sk: "1" }])).rejects.toThrow("ProvisionedThroughputExceeded");
  });

  it("returns one result per group, keyed by group name", async () => {
    mockSend.mockImplementation((command, cb) => {
      const pk = command.input.RequestItems.t.Keys[0].pk.S;
      cb(null, { Responses: { t: items({ pk }) } });
    });

    const res = await db.parallelizedBatchGetData({ policies: [{ pk: "p", sk: "1" }], products: [{ pk: "q", sk: "1" }] }, "t");

    expect(res).toEqual([{ key: "policies", data: [{ pk: "p" }] }, { key: "products", data: [{ pk: "q" }] }]);
  });
});

describe("batchWriteData", () => {
  it("writes put requests in chunks of the given size", async () => {
    mockSend.mockResolvedValue({});
    const rows = [1, 2, 3].map((n) => ({ pk: { S: `p${n}` } }));

    await db.batchWriteData(rows, 2, "t");

    expect(sent()).toEqual([
      ["BatchWriteItemCommand", { RequestItems: { t: [{ PutRequest: { Item: rows[0] } }, { PutRequest: { Item: rows[1] } }] } }],
      ["BatchWriteItemCommand", { RequestItems: { t: [{ PutRequest: { Item: rows[2] } }] } }],
    ]);
  });

  it("names the failing chunk", async () => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockSend.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("boom"));

    await expect(db.batchWriteData([{}, {}, {}], 2)).rejects.toThrow("Error batch writing items in chunk 1: Error: boom");
    console.log.mockRestore();
  });
});

describe("batchTransactData", () => {
  const ok = { $metadata: { httpStatusCode: 200 } };

  it("wraps plain items in the default Put and honours per-item Update and Delete", async () => {
    mockSend.mockResolvedValue(ok);
    const put = { TableName: "t", Item: { pk: { S: "a" } } };
    const update = { TableName: "t", Key: { pk: { S: "b" } }, UpdateExpression: "SET x = :x" };
    const del = { TableName: "t", Key: { pk: { S: "c" } } };

    await expect(db.batchTransactData([put, { action: "Update", data: update }, { action: "Delete", data: del }])).resolves.toBe(true);

    expect(sent()).toEqual([["TransactWriteItemsCommand", {
      TransactItems: [{ Put: put }, { Update: update }, { Delete: del }],
    }]]);
  });

  it("uses the given default action for items without one", async () => {
    mockSend.mockResolvedValue(ok);
    const key = { TableName: "t", Key: { pk: { S: "a" } } };

    await db.batchTransactData([key], "Delete");

    expect(sent()[0][1].TransactItems).toEqual([{ Delete: key }]);
  });

  it("sends more than 100 items as separate transactions", async () => {
    mockSend.mockResolvedValue(ok);
    const rows = Array.from({ length: 101 }, (_, i) => ({ TableName: "t", Item: { pk: { S: `${i}` } } }));

    await db.batchTransactData(rows);

    expect(mockSend.mock.calls.map(([c]) => c.input.TransactItems.length)).toEqual([100, 1]);
  });

  it("fails on a non-200 response", async () => {
    mockSend.mockResolvedValue({ $metadata: { httpStatusCode: 500 } });

    await expect(db.batchTransactData([{}])).rejects.toThrow("BatchTransactItems failed with status code: 500");
  });
});

describe("isConditionFailure", () => {
  it.each([
    [{ name: "TransactionCanceledException", CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }] }, true],
    [{ name: "TransactionCanceledException", CancellationReasons: [{ Code: "TransactionConflict" }] }, false],
    [{ name: "TransactionCanceledException" }, false],
    [{ name: "ConditionalCheckFailedException" }, false],
    [undefined, false],
  ])("%p -> %p", (error, expected) => {
    expect(db.isConditionFailure(error)).toBe(expected);
  });
});
