"use strict";

const mockSend = jest.fn();
const fakeClient = () => ({ send: (...args) => mockSend(...args) });
jest.mock("@aws-sdk/client-ses", () => ({ ...jest.requireActual("@aws-sdk/client-ses"), SESClient: jest.fn(fakeClient) }));
jest.mock("@aws-sdk/client-sqs", () => ({ ...jest.requireActual("@aws-sdk/client-sqs"), SQSClient: jest.fn(fakeClient) }));
jest.mock("@aws-sdk/client-sns", () => ({ ...jest.requireActual("@aws-sdk/client-sns"), SNSClient: jest.fn(fakeClient) }));
jest.mock("@aws-sdk/client-ssm", () => ({ ...jest.requireActual("@aws-sdk/client-ssm"), SSMClient: jest.fn(fakeClient) }));
jest.mock("@aws-sdk/client-secrets-manager", () => ({
  ...jest.requireActual("@aws-sdk/client-secrets-manager"),
  SecretsManagerClient: jest.fn(fakeClient),
}));

const ses = require("/opt/awsUtils/ses");
const sns = require("/opt/awsUtils/sns");
const ssm = require("/opt/ssm");
const sqs = require("../../src/layers/awsUtils/sqs");
const { getSecretValue } = require("../../src/layers/awsUtils/secretsManager");

const sent = () => mockSend.mock.calls.map(([command]) => [command.constructor.name, command.input]);

beforeEach(() => mockSend.mockReset());

describe("ses", () => {
  it("sends html and text bodies with reply-to and tags", async () => {
    mockSend.mockResolvedValue({ MessageId: "m1" });

    const res = await ses.sendEmail({
      source: "noreply@x.test",
      destination: { ToAddresses: ["a@x.test"] },
      subject: "Hi",
      htmlBody: "<p>Hi</p>",
      textBody: "Hi",
      replyToAddresses: ["help@x.test"],
      tags: [{ Name: "type", Value: "booking" }],
    });

    expect(res).toEqual({ MessageId: "m1" });
    expect(sent()).toEqual([["SendEmailCommand", {
      Source: "noreply@x.test",
      Destination: { ToAddresses: ["a@x.test"] },
      Message: {
        Subject: { Data: "Hi", Charset: "UTF-8" },
        Body: { Html: { Data: "<p>Hi</p>", Charset: "UTF-8" }, Text: { Data: "Hi", Charset: "UTF-8" } },
      },
      ReplyToAddresses: ["help@x.test"],
      Tags: [{ Name: "type", Value: "booking" }],
    }]]);
  });

  it("leaves out empty bodies, reply-to and tags", async () => {
    mockSend.mockResolvedValue({});

    await ses.sendEmail({ source: "s", destination: { ToAddresses: ["a"] }, subject: "x", textBody: "t" });

    expect(sent()[0][1]).toEqual({
      Source: "s",
      Destination: { ToAddresses: ["a"] },
      Message: { Subject: { Data: "x", Charset: "UTF-8" }, Body: { Text: { Data: "t", Charset: "UTF-8" } } },
    });
  });

  it("sends a raw message", async () => {
    mockSend.mockResolvedValue({ MessageId: "m2" });

    await expect(ses.sendRawEmail({ source: "s", destinations: ["a"], rawMessage: "MIME", tags: [{ Name: "k", Value: "v" }] }))
      .resolves.toEqual({ MessageId: "m2" });
    expect(sent()).toEqual([["SendRawEmailCommand", {
      Source: "s", Destinations: ["a"], RawMessage: { Data: "MIME" }, Tags: [{ Name: "k", Value: "v" }],
    }]]);
  });

  it("returns the send quota", async () => {
    mockSend.mockResolvedValue({ Max24HourSend: 50000, MaxSendRate: 14, SentLast24Hours: 3 });

    await expect(ses.getSendQuota()).resolves.toEqual({ Max24HourSend: 50000, MaxSendRate: 14, SentLast24Hours: 3 });
    expect(sent()[0][0]).toBe("GetSendQuotaCommand");
  });

  it.each([
    ["sendEmail", () => ses.sendEmail({ source: "s", destination: { ToAddresses: ["a"] }, subject: "x" })],
    ["sendRawEmail", () => ses.sendRawEmail({ source: "s", destinations: ["a"], rawMessage: "m" })],
    ["getSendQuota", () => ses.getSendQuota()],
  ])("%s rethrows an SES failure", async (_name, call) => {
    mockSend.mockRejectedValue(new Error("MessageRejected"));

    await expect(call()).rejects.toThrow("MessageRejected");
  });

  it("formats destinations, wrapping single addresses and dropping empty lists", () => {
    expect(ses.formatDestination({ to: ["a"], cc: "c", bcc: "b" })).toEqual({
      ToAddresses: ["a"], CcAddresses: ["c"], BccAddresses: ["b"],
    });
    expect(ses.formatDestination({ to: "a" })).toEqual({ ToAddresses: ["a"] });
  });

  it("makes tags only from non-empty strings up to 256 characters", () => {
    expect(ses.createEmailTags({ type: "booking", n: 5, empty: "", long: "x".repeat(257), max: "y".repeat(256) })).toEqual([
      { Name: "type", Value: "booking" },
      { Name: "max", Value: "y".repeat(256) },
    ]);
    expect(ses.createEmailTags()).toEqual([]);
  });
});

describe("sqs", () => {
  it("serializes an object body and passes FIFO and delay options", async () => {
    mockSend.mockResolvedValue({ MessageId: "q1" });
    const attrs = { type: { DataType: "String", StringValue: "x" } };

    await expect(sqs.sendMessage({
      queueUrl: "https://q", messageBody: { a: 1 }, messageAttributes: attrs,
      delaySeconds: 5, messageGroupId: "g", messageDeduplicationId: "d",
    })).resolves.toEqual({ MessageId: "q1" });
    expect(sent()).toEqual([["SendMessageCommand", {
      QueueUrl: "https://q", MessageBody: '{"a":1}', MessageAttributes: attrs,
      DelaySeconds: 5, MessageGroupId: "g", MessageDeduplicationId: "d",
    }]]);
  });

  it("sends a string body as is, without optional fields", async () => {
    mockSend.mockResolvedValue({});

    await sqs.sendMessage({ queueUrl: "https://q", messageBody: "raw" });

    expect(sent()[0][1]).toEqual({ QueueUrl: "https://q", MessageBody: "raw" });
  });

  it("numbers batch entries without ids and keeps given ones", async () => {
    mockSend.mockResolvedValue({ Successful: [{}], Failed: [] });

    await sqs.sendMessageBatch({
      queueUrl: "https://q",
      entries: [
        { messageBody: { a: 1 } },
        { id: "x", messageBody: "s", messageAttributes: { k: {} }, delaySeconds: 2, messageGroupId: "g", messageDeduplicationId: "d" },
      ],
    });

    expect(sent()).toEqual([["SendMessageBatchCommand", {
      QueueUrl: "https://q",
      Entries: [
        { Id: "0", MessageBody: '{"a":1}' },
        { Id: "x", MessageBody: "s", MessageAttributes: { k: {} }, DelaySeconds: 2, MessageGroupId: "g", MessageDeduplicationId: "d" },
      ],
    }]]);
  });

  it("receives with defaults, adding a visibility timeout only when given", async () => {
    mockSend.mockResolvedValue({ Messages: [{ Body: "b" }] });

    await expect(sqs.receiveMessages({ queueUrl: "https://q" })).resolves.toEqual({ Messages: [{ Body: "b" }] });
    await sqs.receiveMessages({ queueUrl: "https://q", maxNumberOfMessages: 10, waitTimeSeconds: 20, visibilityTimeoutSeconds: 30, messageAttributeNames: ["a"] });

    expect(sent()).toEqual([
      ["ReceiveMessageCommand", { QueueUrl: "https://q", MaxNumberOfMessages: 1, WaitTimeSeconds: 0, MessageAttributeNames: ["All"] }],
      ["ReceiveMessageCommand", { QueueUrl: "https://q", MaxNumberOfMessages: 10, WaitTimeSeconds: 20, MessageAttributeNames: ["a"], VisibilityTimeout: 30 }],
    ]);
  });

  it("deletes by receipt handle", async () => {
    mockSend.mockResolvedValue({});

    await sqs.deleteMessage({ queueUrl: "https://q", receiptHandle: "rh" });

    expect(sent()).toEqual([["DeleteMessageCommand", { QueueUrl: "https://q", ReceiptHandle: "rh" }]]);
  });

  it.each([
    ["sendMessage", () => sqs.sendMessage({ queueUrl: "q", messageBody: "x" })],
    ["sendMessageBatch", () => sqs.sendMessageBatch({ queueUrl: "q", entries: [] })],
    ["receiveMessages", () => sqs.receiveMessages({ queueUrl: "q" })],
    ["deleteMessage", () => sqs.deleteMessage({ queueUrl: "q", receiptHandle: "r" })],
  ])("%s rethrows an SQS failure", async (_name, call) => {
    mockSend.mockRejectedValue(new Error("QueueDoesNotExist"));

    await expect(call()).rejects.toThrow("QueueDoesNotExist");
  });

  it("types message attributes and skips null, undefined and other types", () => {
    const bin = Buffer.from("hi");

    expect(sqs.createMessageAttributes({ s: "a", n: 4.5, b: bin, nul: null, und: undefined, bool: true })).toEqual({
      s: { DataType: "String", StringValue: "a" },
      n: { DataType: "Number", StringValue: "4.5" },
      b: { DataType: "Binary", BinaryValue: bin },
    });
    expect(sqs.createMessageAttributes()).toEqual({});
  });
});

describe("sns", () => {
  it("publishes a JSON message with subject and attributes", async () => {
    mockSend.mockResolvedValue({ MessageId: "n1" });
    const attrs = { kind: { DataType: "String", StringValue: "x" } };

    const command = sns.snsPublishCommand("arn:topic", { a: 1 }, "Subj", attrs);
    await expect(sns.snsPublishSend(command)).resolves.toEqual({ MessageId: "n1" });

    expect(sent()).toEqual([["PublishCommand", {
      TopicArn: "arn:topic", Message: '{"a":1}', Subject: "Subj", MessageAttributes: attrs,
    }]]);
  });

  it("defaults to no message attributes", () => {
    expect(sns.snsPublishCommand("arn:topic", "x", "s").input.MessageAttributes).toEqual({});
  });

  it.each([
    [{ IS_OFFLINE: "true" }, "http://host.docker.internal:4100"],
    [{ SNS_ENDPOINT_URL: "http://localhost:4566" }, "http://localhost:4566"],
  ])("points the client at a local endpoint with dummy credentials when %p", (env, endpoint) => {
    const { SNSClient } = require("@aws-sdk/client-sns");
    Object.assign(process.env, env);
    jest.isolateModules(() => require("/opt/awsUtils/sns"));
    Object.keys(env).forEach((k) => delete process.env[k]);

    expect(SNSClient).toHaveBeenLastCalledWith({
      region: "ca-central-1",
      endpoint,
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
    });
  });
});

describe("ssm", () => {
  it("returns one decrypted parameter value", async () => {
    mockSend.mockResolvedValue({ Parameter: { Name: "/a", Value: "v" } });

    await expect(ssm.getParameter("/a")).resolves.toBe("v");
    expect(sent()).toEqual([["GetParameterCommand", { Name: "/a", WithDecryption: true }]]);
  });

  it("maps several parameters by name", async () => {
    mockSend.mockResolvedValue({ Parameters: [{ Name: "/a", Value: "1" }, { Name: "/b", Value: "2" }] });

    await expect(ssm.getSSMParameters(["/a", "/b"], false)).resolves.toEqual({ "/a": "1", "/b": "2" });
    expect(sent()).toEqual([["GetParametersCommand", { Names: ["/a", "/b"], WithDecryption: false }]]);
  });

  it("maps parameters under a path", async () => {
    mockSend.mockResolvedValue({ Parameters: [{ Name: "/p/x", Value: "1" }] });

    await expect(ssm.getParametersByPath("/p")).resolves.toEqual({ "/p/x": "1" });
    expect(sent()).toEqual([["GetParametersByPathCommand", { Path: "/p", Recursive: true, WithDecryption: true }]]);
  });

  it.each([
    [() => ssm.getParameter("/a"), "Failed to get parameter /a: ParameterNotFound"],
    [() => ssm.getSSMParameters(["/a"]), "Failed to get parameters: ParameterNotFound"],
    [() => ssm.getParametersByPath("/p"), "Failed to get parameters by path /p: ParameterNotFound"],
  ])("names the parameter in the error", async (call, message) => {
    mockSend.mockRejectedValue(new Error("ParameterNotFound"));

    await expect(call()).rejects.toThrow(message);
  });
});

describe("secretsManager", () => {
  afterEach(() => {
    delete process.env.IS_OFFLINE;
    delete process.env.MY_SECRET;
  });

  it("parses a JSON secret string", async () => {
    mockSend.mockResolvedValue({ SecretString: '{"key":"v"}' });

    await expect(getSecretValue("MY_SECRET")).resolves.toEqual({ key: "v" });
    expect(sent()).toEqual([["GetSecretValueCommand", { SecretId: "MY_SECRET" }]]);
  });

  it("returns the whole response for a binary secret", async () => {
    mockSend.mockResolvedValue({ SecretBinary: "AAAA" });

    await expect(getSecretValue("MY_SECRET")).resolves.toEqual({ SecretBinary: "AAAA" });
  });

  it("reads the environment instead when offline", async () => {
    process.env.IS_OFFLINE = "true";
    process.env.MY_SECRET = "local-value";

    await expect(getSecretValue("MY_SECRET")).resolves.toBe("local-value");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("rethrows a Secrets Manager failure", async () => {
    mockSend.mockRejectedValue(new Error("AccessDenied"));

    await expect(getSecretValue("MY_SECRET")).rejects.toThrow("AccessDenied");
  });
});
