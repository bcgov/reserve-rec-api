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

// Audit records writeAuditLog sent through a mocked batchWriteData, unmarshalled
function auditRecords(batchWriteData) {
  const { unmarshall } = require("@aws-sdk/util-dynamodb");
  return batchWriteData.mock.calls.filter(([, , table]) => table === "audit").map(([[record]]) => unmarshall(record));
}

// Matches the audit record of one relationship link, keyed by its relationship item
function relationshipAudit(operation, { pk1, sk1, pk2, sk2 }, user = "user-1") {
  return expect.objectContaining({
    pk: user,
    operation,
    gsipk: `entity::rel::${pk1}::${sk1}::${pk2}::${sk2}`,
    metadata: expect.objectContaining({ pk1, sk1, pk2, sk2 }),
  });
}

module.exports = { auditRecords, mockModule, relationshipAudit };
