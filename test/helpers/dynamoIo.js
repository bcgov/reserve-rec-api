// Real /opt/dynamodb with only the calls that reach DynamoDB replaced by jest.fn().
// Use as: jest.mock("/opt/dynamodb", () => require("../helpers/dynamoIo").mockModule());
function mockModule() {
  const actual = jest.requireActual("/opt/dynamodb");
  return {
    ...actual,
    runQuery: jest.fn(),
    getOne: jest.fn(),
    batchTransactData: jest.fn(),
    batchWriteData: jest.fn(),
    batchGetData: jest.fn(),
    parallelizedBatchGetData: jest.fn(),
    incrementCounter: jest.fn(),
  };
}

module.exports = { mockModule };
