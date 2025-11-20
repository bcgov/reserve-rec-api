"use strict";

// Mock AWS SDK BEFORE requiring the handler
const mockSQSSend = jest.fn().mockResolvedValue({ MessageId: "sqs-msg-123" });
const mockSQSClient = jest.fn(() => ({
  send: mockSQSSend,
}));
const mockSendMessageCommand = jest.fn((params) => params);

jest.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: mockSQSClient,
  SendMessageCommand: mockSendMessageCommand,
}));

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
    this.originalError = data.originalError;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("/opt/dynamodb", () => ({
  batchTransactData: jest.fn(),
  TRANSACTIONAL_DATA_TABLE_NAME: "TestTable",
}));

jest.mock("../../src/common/data-utils", () => ({
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));

jest.mock("../../src/handlers/transactions/configs", () => ({
  REFUND_PUT_CONFIG: {},
  TRANSACTION_UPDATE_CONFIG: {},
  REFUND_UPDATE_CONFIG: {},
}));

jest.mock("../../src/handlers/transactions/methods", () => ({
  createRefund: jest.fn(),
  createAndCheckRefundHash: jest.fn(),
  findAndVerifyTransactionOwnership: jest.fn(),
  updateTransactionForRefund: jest.fn(),
}));

// Set environment variable before requiring handler
process.env.WORLDLINE_REQUEST_QUEUE_URL = "https://sqs.amazonaws.com/queue/worldline";

const { handler } = require("../../src/handlers/transactions/refunds/subscriber/index");
const {
  createRefund,
  createAndCheckRefundHash,
  findAndVerifyTransactionOwnership,
  updateTransactionForRefund,
} = require("../../src/handlers/transactions/methods");
const { quickApiPutHandler, quickApiUpdateHandler } = require("../../src/common/data-utils");
const { batchTransactData } = require("/opt/dynamodb");

describe("Refund Subscriber", () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
    mockSQSSend.mockResolvedValue({ MessageId: "sqs-msg-123" });
  });

  it("should skip non-SNS records", async () => {
    const event = {
      Records: [
        {
          EventSource: "aws:dynamodb",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              refundAmount: 50.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).results).toEqual([]);
  });

  it("should successfully process a refund request", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "paid",
      amount: 100.0,
      trnId: "worldline-123",
      user: "user-123",
    };

    const mockRefundMetadata = {
      refundHash: "hash123",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 50.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz" },
      data: {
        pk: "transaction::BCPR-abc123",
        sk: "refund::RFND-xyz",
        refundTransactionId: "RFND-xyz",
        amount: 50.0,
      },
    };

    const mockUpdateData = {
      key: { pk: "transaction::BCPR-abc123", sk: "details" },
      data: {
        transactionStatus: "refund in progress",
        refundAmounts: { value: [{ "RFND-xyz": 50.0 }], action: "set" },
      },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundMetadata);
    createRefund.mockResolvedValue(mockRefundData);
    updateTransactionForRefund.mockResolvedValue(mockUpdateData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              bookingId: "booking-123",
              user: "user-123",
              refundAmount: 50.0,
              reason: "Cancellation by user via self-serve",
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(findAndVerifyTransactionOwnership).toHaveBeenCalledWith(
      "BCPR-abc123",
      "user-123"
    );
    expect(createAndCheckRefundHash).toHaveBeenCalledWith(
      "user-123",
      "BCPR-abc123",
      50.0
    );
    expect(createRefund).toHaveBeenCalledWith(
      mockTransaction,
      50.0,
      mockRefundMetadata.refundHash,
      {
        reason: "Cancellation by user via self-serve",
        refundSequence: mockRefundMetadata.refundSequence,
      }
    );
    expect(updateTransactionForRefund).toHaveBeenCalledWith(
      mockTransaction,
      50.0,
      "RFND-xyz",
      50.0
    );
    expect(mockSQSSend).toHaveBeenCalled();

    const body = JSON.parse(result.body);
    expect(result.statusCode).toBe(200);
    expect(body.message).toBe("Refunds processed");
    expect(body.results).toHaveLength(1);
    expect(body.results[0].transactionStatus).toBe("queued_for_processing");
    expect(body.results[0].refundId).toBe("RFND-xyz");
  });

  it("should skip already fully refunded transactions", async () => {
    const mockTransaction = {
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "refunded",
      user: "user-123",
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results[0].transactionStatus).toBe("already_refunded");
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("should skip transactions not eligible for refund", async () => {
    const mockTransaction = {
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "in progress",
      user: "user-123",
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results[0].transactionStatus).toBe("not_eligible");
    expect(body.results[0].currentStatus).toBe("in progress");
  });

  it("should validate refund does not exceed transaction amount", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "partial refund",
      amount: 100.0,
      user: "user-123",
    };

    const mockRefundMetadata = {
      refundHash: "hash456",
      refundSequence: 2,
      totalRefunded: 60.0,
      totalAfterRefund: 110.0, // Exceeds original amount
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundMetadata);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("exceed transaction amount");
  });

  it("should queue Worldline request to SQS after creating refund", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "paid",
      amount: 100.0,
      trnId: "worldline-123",
      user: "user-123",
    };

    const mockRefundMetadata = {
      refundHash: "hash789",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 100.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz" },
      data: {
        pk: "transaction::BCPR-abc123",
        sk: "refund::RFND-xyz",
        refundTransactionId: "RFND-xyz",
        amount: 100.0,
      },
    };

    const mockUpdateData = {
      key: { pk: "transaction::BCPR-abc123", sk: "details" },
      data: { transactionStatus: "refund in progress" },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundMetadata);
    createRefund.mockResolvedValue(mockRefundData);
    updateTransactionForRefund.mockResolvedValue(mockUpdateData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 100.0,
            }),
          },
        },
      ],
    };

    await handler(event, context);

    // Check that SendMessageCommand was called with the correct parameters
    expect(mockSendMessageCommand).toHaveBeenCalled();
    const sqsMessageParams = mockSendMessageCommand.mock.calls[0][0];
    expect(sqsMessageParams.QueueUrl).toBe(
      "https://sqs.amazonaws.com/queue/worldline"
    );

    const messageBody = JSON.parse(sqsMessageParams.MessageBody);
    expect(messageBody.refundTransactionId).toBe("RFND-xyz");
    expect(messageBody.originalTransactionId).toBe("BCPR-abc123");
    expect(messageBody.worldlineTransactionId).toBe("worldline-123");
    expect(messageBody.refundAmount).toBe(100.0);
    expect(messageBody.pendingTransactionStatus).toBe("refunded");
  });

  it("should mark refund as failed if SQS queueing fails", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "paid",
      amount: 100.0,
      trnId: "worldline-123",
      user: "user-123",
    };

    const mockRefundMetadata = {
      refundHash: "hash999",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 50.0,
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-xyz" },
      data: {
        pk: "transaction::BCPR-abc123",
        sk: "refund::RFND-xyz",
        refundTransactionId: "RFND-xyz",
        amount: 50.0,
      },
    };

    const mockUpdateData = {
      key: { pk: "transaction::BCPR-abc123", sk: "details" },
      data: { transactionStatus: "refund in progress" },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundMetadata);
    createRefund.mockResolvedValue(mockRefundData);
    updateTransactionForRefund.mockResolvedValue(mockUpdateData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    // Mock SQS failure
    mockSQSSend.mockRejectedValue(new Error("SQS error"));

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    // Should have called update to mark as failed
    expect(quickApiUpdateHandler).toHaveBeenCalledTimes(2); // Once for transaction, once for failed refund
    expect(result.statusCode).toBe(500);
    const body = JSON.parse(result.body);
    expect(body.message).toContain("Failed to queue Worldline request");
  });

  it("should process multiple refunds in batch", async () => {
    const mockTransaction1 = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "paid",
      amount: 100.0,
      trnId: "worldline-123",
      user: "user-123",
    };

    const mockTransaction2 = {
      pk: "transaction::BCPR-def456",
      sk: "details",
      clientTransactionId: "BCPR-def456",
      transactionStatus: "paid",
      amount: 200.0,
      trnId: "worldline-456",
      user: "user-456",
    };

    const mockRefundMetadata1 = {
      refundHash: "hash1",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 50.0,
    };

    const mockRefundMetadata2 = {
      refundHash: "hash2",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 75.0,
    };

    const mockRefundData1 = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-1" },
      data: {
        pk: "transaction::BCPR-abc123",
        sk: "refund::RFND-1",
        refundTransactionId: "RFND-1",
        amount: 50.0,
      },
    };

    const mockRefundData2 = {
      key: { pk: "transaction::BCPR-def456", sk: "refund::RFND-2" },
      data: {
        pk: "transaction::BCPR-def456",
        sk: "refund::RFND-2",
        refundTransactionId: "RFND-2",
        amount: 75.0,
      },
    };

    findAndVerifyTransactionOwnership
      .mockResolvedValueOnce(mockTransaction1)
      .mockResolvedValueOnce(mockTransaction2);
    createAndCheckRefundHash
      .mockResolvedValueOnce(mockRefundMetadata1)
      .mockResolvedValueOnce(mockRefundMetadata2);
    createRefund
      .mockResolvedValueOnce(mockRefundData1)
      .mockResolvedValueOnce(mockRefundData2);
    updateTransactionForRefund.mockResolvedValue({
      key: { pk: "mock", sk: "mock" },
      data: {},
    });
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0,
            }),
          },
        },
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-def456",
              user: "user-456",
              refundAmount: 75.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results).toHaveLength(2);
    expect(body.results[0].refundId).toBe("RFND-1");
    expect(body.results[1].refundId).toBe("RFND-2");
  });

  it("should handle partial refund status correctly", async () => {
    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "paid",
      amount: 100.0,
      trnId: "worldline-123",
      user: "user-123",
    };

    const mockRefundMetadata = {
      refundHash: "hash-partial",
      refundSequence: 1,
      totalRefunded: 0,
      totalAfterRefund: 30.0, // Partial refund (less than full amount)
    };

    const mockRefundData = {
      key: { pk: "transaction::BCPR-abc123", sk: "refund::RFND-partial" },
      data: {
        pk: "transaction::BCPR-abc123",
        sk: "refund::RFND-partial",
        refundTransactionId: "RFND-partial",
        amount: 30.0,
      },
    };

    const mockUpdateData = {
      key: { pk: "transaction::BCPR-abc123", sk: "details" },
      data: { transactionStatus: "refund in progress" },
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockRefundMetadata);
    createRefund.mockResolvedValue(mockRefundData);
    updateTransactionForRefund.mockResolvedValue(mockUpdateData);
    quickApiPutHandler.mockResolvedValue([{ putItem: "data" }]);
    quickApiUpdateHandler.mockResolvedValue([{ updateItem: "data" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 30.0,
            }),
          },
        },
      ],
    };

    await handler(event, context);

    // Check that SendMessageCommand was called
    expect(mockSendMessageCommand).toHaveBeenCalled();
    const sqsMessageParams = mockSendMessageCommand.mock.calls[0][0];
    const messageBody = JSON.parse(sqsMessageParams.MessageBody);
    expect(messageBody.pendingTransactionStatus).toBe("partial refund");
  });

  it("should handle duplicate refund attempts", async () => {
    const mockTransaction = {
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "paid",
      amount: 100.0,
      user: "user-123",
    };

    const error = new Error("Duplicate refund attempt detected");
    error.code = 409;

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockRejectedValue(error);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0,
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results[0].transactionStatus).toBe("already_processed");
  });

  it("should allow duplicate amount refunds outside the 3-minute window", async () => {
    const { DateTime } = require("luxon");
    const now = DateTime.now();
    const oldRefundTime = now.minus({ minutes: 5 }); // Outside 3-minute window

    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "partial refund",
      amount: 100.0,
      user: "user-123",
      refundAmounts: [{ "RFND-old123": 30.0 }],
      // Show that an old refund exists with a timestamp outside the window
      existingRefunds: [
        {
          amount: 30.0,
          createdAt: oldRefundTime.toISO(),
          transactionStatus: "refunded",
        },
      ],
    };

    // Mock the hash method to return metadata showing old refund exists but is outside window
    // so this new refund is allowed
    const mockHashMetadata = {
      refundHash: "hash123",
      refundSequence: 2,
      totalRefunded: 30.0,
      totalAfterRefund: 60.0,
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockHashMetadata);
    createRefund.mockResolvedValue({
      key: { pk: mockTransaction.pk, sk: "refund::RFND-new456" },
      data: {
        amount: 30.0,
        refundTransactionId: "RFND-new456",
        transactionStatus: "refund in progress",
      },
    });
    updateTransactionForRefund.mockResolvedValue({
      key: { pk: mockTransaction.pk, sk: "details" },
      data: { transactionStatus: "partial refund" },
    });
    quickApiPutHandler.mockResolvedValue([{ put: "item" }]);
    quickApiUpdateHandler.mockResolvedValue([{ update: "item" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 30.0, // Same amount as old refund
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results[0].transactionStatus).toBe("queued_for_processing");
    expect(createAndCheckRefundHash).toHaveBeenCalled();
    expect(createRefund).toHaveBeenCalled();
  });

  it("should reject duplicate amount refunds within the 3-minute window", async () => {
    const { DateTime } = require("luxon");
    const now = DateTime.now();
    const recentRefundTime = now.minus({ minutes: 1 }); // Within 3-minute window

    const mockTransaction = {
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "partial refund",
      amount: 100.0,
      user: "user-123",
      refundAmounts: [{ "RFND-recent123": 30.0 }],
      // Show that a recent refund exists with a timestamp within the window
      existingRefunds: [
        {
          amount: 30.0,
          createdAt: recentRefundTime.toISO(), // Only 1 minute ago
          transactionStatus: "refund in progress",
        },
      ],
    };

    // Mock createAndCheckRefundHash to reject because it detects a duplicate within the window
    const error = new Error("Duplicate refund of $30 detected within 3 minutes");
    error.code = 409;

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockRejectedValue(error);

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 30.0, // Same amount as recent refund
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results[0].transactionStatus).toBe("already_processed");
    expect(createAndCheckRefundHash).toHaveBeenCalled();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it("should allow multiple refunds with different amounts within the time window (not a duplicate refund)", async () => {
    const { DateTime } = require("luxon");
    const now = DateTime.now();
    const recentRefundTime = now.minus({ minutes: 1 }); // Within 3-minute window

    const mockTransaction = {
      pk: "transaction::BCPR-abc123",
      sk: "details",
      clientTransactionId: "BCPR-abc123",
      transactionStatus: "partial refund",
      amount: 100.0,
      user: "user-123",
      refundAmounts: [{ "RFND-first123": 20.0 }],
      // Show that a recent refund exists within the window but with a different amount
      existingRefunds: [
        {
          amount: 20.0,
          createdAt: recentRefundTime.toISO(), // Only 1 minute ago
          transactionStatus: "refund in progress",
        },
      ],
    };

    // Mock shows that even though there's a recent refund, the different amount is allowed
    const mockHashMetadata = {
      refundHash: "hash456",
      refundSequence: 2,
      totalRefunded: 20.0,
      totalAfterRefund: 70.0,
    };

    findAndVerifyTransactionOwnership.mockResolvedValue(mockTransaction);
    createAndCheckRefundHash.mockResolvedValue(mockHashMetadata);
    createRefund.mockResolvedValue({
      key: { pk: mockTransaction.pk, sk: "refund::RFND-second456" },
      data: {
        amount: 50.0, // Different amount from the recent $20 refund
        refundTransactionId: "RFND-second456",
        transactionStatus: "refund in progress",
      },
    });
    updateTransactionForRefund.mockResolvedValue({
      key: { pk: mockTransaction.pk, sk: "details" },
      data: { transactionStatus: "partial refund" },
    });
    quickApiPutHandler.mockResolvedValue([{ put: "item" }]);
    quickApiUpdateHandler.mockResolvedValue([{ update: "item" }]);
    batchTransactData.mockResolvedValue({ success: true });

    const event = {
      Records: [
        {
          EventSource: "aws:sns",
          Sns: {
            Message: JSON.stringify({
              clientTransactionId: "BCPR-abc123",
              user: "user-123",
              refundAmount: 50.0, // Different amount from existing 20.0
            }),
          },
        },
      ],
    };

    const result = await handler(event, context);

    const body = JSON.parse(result.body);
    expect(body.results[0].transactionStatus).toBe("queued_for_processing");
    expect(createAndCheckRefundHash).toHaveBeenCalled();
    expect(createRefund).toHaveBeenCalledWith(
      mockTransaction,
      50.0,
      mockHashMetadata.refundHash,
      expect.objectContaining({ refundSequence: 2 })
    );
  });
});

