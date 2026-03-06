'use strict';

const {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
  DeleteItemCommand,
  QueryCommand,
  ScanCommand,
  BatchWriteItemCommand,
  ConditionalCheckFailedException,
} = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const TABLE_NAME = process.env.WAITING_ROOM_TABLE_NAME;
const REGION = process.env.AWS_REGION || 'ca-central-1';

// Lazy-initialized client
let _client;
function getClient() {
  if (!_client) {
    _client = new DynamoDBClient({ region: REGION });
  }
  return _client;
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function buildQueueId(collectionId, activityType, activityId, startDate) {
  return `QUEUE#${collectionId}#${activityType}#${activityId}#${startDate}`;
}

function buildMetaSk() {
  return 'META';
}

function buildEntrySk(cognitoSub) {
  return `ENTRY#${cognitoSub}`;
}

// ─── Queue Meta operations ────────────────────────────────────────────────────

/**
 * Reads a Queue Meta record.
 */
async function getQueueMeta(queueId) {
  const result = await getClient().send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildMetaSk() }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

/**
 * Creates a Queue Meta record. Fails if it already exists.
 */
async function createQueueMeta(item) {
  await getClient().send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(item),
    ConditionExpression: 'attribute_not_exists(pk)',
  }));
}

/**
 * Creates or overwrites a Queue Meta record (unconditional).
 * Used for re-activating Mode 2 queues on the same day without a condition error.
 */
async function putQueueMeta(item) {
  await getClient().send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(item),
  }));
}

/**
 * Updates lastReleasedAt on a Queue Meta record.
 * Called by the Release Lambda after each Mode 2 batch.
 */
async function updateQueueMetaLastReleasedAt(queueId, timestamp, admittedIncrement = 0) {
  const update = admittedIncrement > 0
    ? 'SET lastReleasedAt = :ts, updatedAt = :ts ADD admittedCount :inc'
    : 'SET lastReleasedAt = :ts, updatedAt = :ts';
  const values = admittedIncrement > 0
    ? marshall({ ':ts': timestamp, ':inc': admittedIncrement })
    : marshall({ ':ts': timestamp });
  await getClient().send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildMetaSk() }),
    UpdateExpression: update,
    ExpressionAttributeValues: values,
  }));
}

/**
 * Atomically increments abandonedCount on a Queue Meta record.
 */
async function incrementAbandonedCount(queueId, count) {
  await getClient().send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildMetaSk() }),
    UpdateExpression: 'ADD abandonedCount :count',
    ExpressionAttributeValues: marshall({ ':count': count }),
  }));
}

/**
 * Atomically updates queueStatus with an optional condition on expected current status.
 *
 * @param {string} queueId
 * @param {string} newStatus
 * @param {string|null} expectedCurrentStatus - If provided, only updates if current status matches
 * @returns {boolean} true if updated, false if condition failed
 */
async function updateQueueMetaStatus(queueId, newStatus, expectedCurrentStatus = null) {
  const params = {
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildMetaSk() }),
    UpdateExpression: 'SET queueStatus = :newStatus, updatedAt = :now',
    ExpressionAttributeValues: marshall({
      ':newStatus': newStatus,
      ':now': Math.floor(Date.now() / 1000),
    }),
  };
  if (expectedCurrentStatus) {
    params.ConditionExpression = 'queueStatus = :expected';
    params.ExpressionAttributeValues = marshall({
      ':newStatus': newStatus,
      ':now': Math.floor(Date.now() / 1000),
      ':expected': expectedCurrentStatus,
    });
  }
  try {
    await getClient().send(new UpdateItemCommand(params));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/**
 * Atomically increments totalEntries on the Queue Meta record.
 * Used by join handler for late joiners during randomization.
 *
 * @returns {number} New totalEntries value
 */
async function incrementQueueTotalEntries(queueId) {
  const result = await getClient().send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildMetaSk() }),
    UpdateExpression: 'ADD totalEntries :one',
    ExpressionAttributeValues: marshall({ ':one': 1 }),
    ReturnValues: 'UPDATED_NEW',
  }));
  return unmarshall(result.Attributes).totalEntries;
}

/**
 * Atomically increments admittedCount with an optional ceiling check.
 * Returns false if the ceiling would be exceeded (optimistic locking for maxActiveSessions).
 *
 * @param {string} queueId
 * @param {number} batchSize - Number of users being admitted
 * @param {number} maxActiveSessions - Ceiling on concurrent admissions
 * @returns {boolean} true if succeeded, false if ceiling exceeded
 */
async function incrementAdmittedCount(queueId, batchSize, maxActiveSessions) {
  try {
    await getClient().send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: queueId, sk: buildMetaSk() }),
      UpdateExpression: 'ADD admittedCount :batch',
      // attribute_not_exists handles newly-created queues before any admission has occurred;
      // all createQueueMeta paths initialize admittedCount: 0 so this is defensive only.
      ConditionExpression: 'attribute_not_exists(admittedCount) OR admittedCount <= :ceiling',
      ExpressionAttributeValues: marshall({
        ':batch': batchSize,
        ':ceiling': maxActiveSessions - batchSize,
      }),
    }));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/**
 * Atomically decrements admittedCount (floored at 0) when reverting a failed admission.
 *
 * @param {string} queueId
 * @param {number} count - Number of slots to release back
 */
async function decrementAdmittedCount(queueId, count) {
  try {
    await getClient().send(new UpdateItemCommand({
      TableName: TABLE_NAME,
      Key: marshall({ pk: queueId, sk: buildMetaSk() }),
      UpdateExpression: 'SET admittedCount = if_not_exists(admittedCount, :zero) - :count',
      ConditionExpression: 'admittedCount >= :count',
      ExpressionAttributeValues: marshall({ ':count': count, ':zero': 0 }),
    }));
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return; // already at 0, ignore
    throw err;
  }
}

// ─── Queue Entry operations ───────────────────────────────────────────────────

/**
 * Reads a Queue Entry record.
 */
async function getQueueEntry(queueId, cognitoSub) {
  const result = await getClient().send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildEntrySk(cognitoSub) }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

/**
 * Creates or overwrites a Queue Entry record.
 */
async function putQueueEntry(item) {
  await getClient().send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall(item),
  }));
}

/**
 * Updates a Queue Entry's status with optional condition.
 *
 * @param {string} queueId
 * @param {string} cognitoSub
 * @param {string} newStatus
 * @param {string|null} expectedStatus - If provided, only updates if current status matches
 * @param {object} extraUpdates - Additional SET expressions (attribute: value pairs)
 * @returns {boolean} true if updated, false if condition failed
 */
async function updateQueueEntryStatus(queueId, cognitoSub, newStatus, expectedStatus = null, extraUpdates = {}) {
  const setExpressions = ['#status = :newStatus', 'updatedAt = :now'];
  const attrNames = { '#status': 'status' };
  const attrValues = {
    ':newStatus': newStatus,
    ':now': Math.floor(Date.now() / 1000),
  };

  for (const [key, value] of Object.entries(extraUpdates)) {
    setExpressions.push(`#${key} = :${key}`);
    attrNames[`#${key}`] = key;
    attrValues[`:${key}`] = value;
  }

  const params = {
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildEntrySk(cognitoSub) }),
    UpdateExpression: `SET ${setExpressions.join(', ')}`,
    ExpressionAttributeNames: attrNames,
    ExpressionAttributeValues: marshall(attrValues),
  };

  if (expectedStatus) {
    params.ConditionExpression = '#status = :expected';
    params.ExpressionAttributeValues = marshall({
      ...attrValues,
      ':expected': expectedStatus,
    });
  }

  try {
    await getClient().send(new UpdateItemCommand(params));
    return true;
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

/**
 * Sets an entry to 'abandoned' status (used when user joins a new queue).
 */
async function abandonQueueEntry(queueId, cognitoSub) {
  return updateQueueEntryStatus(queueId, cognitoSub, 'abandoned', null, {
    abandonedAt: Math.floor(Date.now() / 1000),
  });
}

/**
 * Sets disconnectedAt on a Queue Entry (called by WebSocket disconnect handler).
 */
async function setDisconnectedAt(queueId, cognitoSub) {
  await getClient().send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildEntrySk(cognitoSub) }),
    UpdateExpression: 'SET disconnectedAt = :now',
    ExpressionAttributeValues: marshall({ ':now': Math.floor(Date.now() / 1000) }),
  }));
}

/**
 * Sets a connectionId on a Queue Entry (called by WebSocket connect handler).
 */
async function setConnectionId(queueId, cognitoSub, connectionId) {
  await getClient().send(new UpdateItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: buildEntrySk(cognitoSub) }),
    UpdateExpression: 'SET connectionId = :cid REMOVE disconnectedAt',
    ExpressionAttributeValues: marshall({ ':cid': connectionId }),
  }));
}

/**
 * Sets an entry to 'admitting' with the admission token.
 * Used by Release Lambda (phase 1 of two-phase admission).
 */
async function setEntryAdmitting(queueId, cognitoSub, admissionToken, admissionExpiry) {
  return updateQueueEntryStatus(queueId, cognitoSub, 'admitting', 'waiting', {
    admissionToken,
    admissionExpiry,
    admittedAt: Math.floor(Date.now() / 1000),
  });
}

/**
 * Sets an entry from 'admitting' to 'admitted'.
 * Used by Release Lambda after successful WebSocket push.
 */
async function setEntryAdmitted(queueId, cognitoSub) {
  return updateQueueEntryStatus(queueId, cognitoSub, 'admitted', 'admitting');
}

// ─── Query operations ─────────────────────────────────────────────────────────

/**
 * Queries all entries for a queue with optional status filter.
 *
 * @param {string} queueId
 * @param {object} options
 * @param {string[]} [options.statuses] - Filter by these statuses
 * @param {string[]} [options.projection] - Projection expression attributes
 * @returns {Promise<object[]>} Array of items
 */
async function queryQueueEntries(queueId, options = {}) {
  const { statuses } = options;

  const params = {
    TableName: TABLE_NAME,
    KeyConditionExpression: 'pk = :pk AND begins_with(sk, :entryPrefix)',
    ExpressionAttributeValues: marshall({
      ':pk': queueId,
      ':entryPrefix': 'ENTRY#',
    }),
  };

  if (statuses && statuses.length > 0) {
    const statusPlaceholders = statuses.map((_, i) => `:s${i}`);
    params.FilterExpression = `#status IN (${statusPlaceholders.join(', ')})`;
    params.ExpressionAttributeNames = { '#status': 'status' };
    for (let i = 0; i < statuses.length; i++) {
      params.ExpressionAttributeValues[`:s${i}`] = { S: statuses[i] };
    }
  }

  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await getClient().send(new QueryCommand(params));
    if (result.Items) items.push(...result.Items.map(i => unmarshall(i)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Queries entries for a user across all queues via the cognitoSub GSI.
 * Used for one-queue-at-a-time enforcement.
 *
 * @param {string} cognitoSub
 * @param {string[]} activeStatuses - Only return entries with these statuses
 * @returns {Promise<object[]>}
 */
async function queryEntriesByCognitoSub(cognitoSub, activeStatuses = ['waiting', 'admitting', 'admitted']) {
  const statusPlaceholders = activeStatuses.map((_, i) => `:s${i}`);

  const params = {
    TableName: TABLE_NAME,
    IndexName: 'cognitoSub-index',
    KeyConditionExpression: 'cognitoSub = :sub',
    FilterExpression: `#status IN (${statusPlaceholders.join(', ')})`,
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: marshall({ ':sub': cognitoSub }),
  };
  for (let i = 0; i < activeStatuses.length; i++) {
    params.ExpressionAttributeValues[`:s${i}`] = { S: activeStatuses[i] };
  }

  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await getClient().send(new QueryCommand(params));
    if (result.Items) items.push(...result.Items.map(i => unmarshall(i)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Queries entries for a client IP in a specific queue via the clientIp GSI.
 * Used for per-IP fairness limit enforcement.
 *
 * @param {string} clientIp
 * @param {string} queueId - Filter by this queue's pk value
 * @returns {Promise<object[]>}
 */
async function queryEntriesByClientIp(clientIp, queueId) {
  const params = {
    TableName: TABLE_NAME,
    IndexName: 'clientIp-index',
    KeyConditionExpression: 'clientIp = :ip AND pk = :queueId',
    FilterExpression: '#status IN (:s0, :s1, :s2)',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: marshall({
      ':ip': clientIp,
      ':queueId': queueId,
      ':s0': 'waiting',
      ':s1': 'admitting',
      ':s2': 'admitted',
    }),
  };

  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await getClient().send(new QueryCommand(params));
    if (result.Items) items.push(...result.Items.map(i => unmarshall(i)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Scans for Queue Meta records with a specific queueStatus.
 * Used by Queue Monitor Lambda.
 *
 * @param {string} status - e.g. 'pre-open', 'releasing', 'randomizing'
 * @returns {Promise<object[]>}
 */
async function scanQueuesByStatus(status) {
  const params = {
    TableName: TABLE_NAME,
    FilterExpression: 'sk = :meta AND queueStatus = :status',
    ExpressionAttributeValues: marshall({
      ':meta': 'META',
      ':status': status,
    }),
  };

  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await getClient().send(new ScanCommand(params));
    if (result.Items) items.push(...result.Items.map(i => unmarshall(i)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Scans for Queue Entry records matching a status with an expired condition.
 * Used by Cleanup Lambda.
 *
 * @param {string} status
 * @param {string} [expiredAttr] - Attribute to check for expiry (e.g. 'admissionExpiry', 'disconnectedAt')
 * @param {number} [expiryThreshold] - Unix timestamp threshold
 * @returns {Promise<object[]>}
 */
async function scanExpiredEntries(status, expiredAttr = null, expiryThreshold = null) {
  let filterExpr = 'begins_with(sk, :entryPrefix) AND #status = :status';
  const attrNames = { '#status': 'status' };
  const attrValues = {
    ':entryPrefix': 'ENTRY#',
    ':status': status,
  };

  if (expiredAttr && expiryThreshold != null) {
    filterExpr += ` AND #${expiredAttr} < :threshold`;
    attrNames[`#${expiredAttr}`] = expiredAttr;
    attrValues[':threshold'] = expiryThreshold;
  }

  const params = {
    TableName: TABLE_NAME,
    FilterExpression: filterExpr,
    ExpressionAttributeNames: attrNames,
    ExpressionAttributeValues: marshall(attrValues),
  };

  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await getClient().send(new ScanCommand(params));
    if (result.Items) items.push(...result.Items.map(i => unmarshall(i)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

// ─── Connection record operations ─────────────────────────────────────────────
// Stored as pk=CONN#{connectionId}, sk=META
// Used to look up (queueId, cognitoSub) in the $disconnect handler.

/**
 * Writes a connection record mapping connectionId → (queueId, cognitoSub).
 * Called by the WebSocket $connect handler. TTL defaults to 1 hour.
 */
async function putConnectionRecord(connectionId, queueId, cognitoSub, ttlSeconds = 3600) {
  await getClient().send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: marshall({
      pk: `CONN#${connectionId}`,
      sk: 'META',
      queueId,
      cognitoSub,
      ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
    }),
  }));
}

/**
 * Reads a connection record by connectionId.
 * Returns { queueId, cognitoSub } or null.
 */
async function getConnectionRecord(connectionId) {
  const result = await getClient().send(new GetItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: `CONN#${connectionId}`, sk: 'META' }),
  }));
  return result.Item ? unmarshall(result.Item) : null;
}

/**
 * Deletes a connection record. Called by the $disconnect handler after recording disconnectedAt.
 */
async function deleteConnectionRecord(connectionId) {
  await getClient().send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: `CONN#${connectionId}`, sk: 'META' }),
  }));
}

/**
 * Scans for all Queue Meta records (all queueStatus values).
 * Used by the admin list-queues handler.
 *
 * @returns {Promise<object[]>}
 */
async function scanAllQueueMetas() {
  const params = {
    TableName: TABLE_NAME,
    FilterExpression: 'sk = :meta AND begins_with(pk, :queuePrefix)',
    ExpressionAttributeValues: marshall({
      ':meta': 'META',
      ':queuePrefix': 'QUEUE#',
    }),
  };

  const items = [];
  let lastKey;
  do {
    if (lastKey) params.ExclusiveStartKey = lastKey;
    const result = await getClient().send(new ScanCommand(params));
    if (result.Items) items.push(...result.Items.map(i => unmarshall(i)));
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);

  return items;
}

/**
 * Deletes a Queue Meta record.
 *
 * @param {string} queueId
 */
async function deleteQueueMeta(queueId) {
  await getClient().send(new DeleteItemCommand({
    TableName: TABLE_NAME,
    Key: marshall({ pk: queueId, sk: 'META' }),
  }));
}

/**
 * Batch-deletes an array of items by their { pk, sk } keys.
 * Used by admin delete-queue handler to remove all entries.
 *
 * @param {Array<{pk: string, sk: string}>} keys
 */
async function batchDeleteItems(keys) {
  const CHUNK_SIZE = 25;
  for (let i = 0; i < keys.length; i += CHUNK_SIZE) {
    const chunk = keys.slice(i, i + CHUNK_SIZE);
    const requests = chunk.map(({ pk, sk }) => ({
      DeleteRequest: { Key: marshall({ pk, sk }) },
    }));
    let remaining = { RequestItems: { [TABLE_NAME]: requests } };
    for (let attempts = 0; attempts < 5; attempts++) {
      const result = await getClient().send(new BatchWriteItemCommand(remaining));
      const unprocessed = result.UnprocessedItems?.[TABLE_NAME];
      if (!unprocessed || unprocessed.length === 0) break;
      remaining = { RequestItems: { [TABLE_NAME]: unprocessed } };
      await new Promise(resolve => setTimeout(resolve, 100 * (attempts + 1)));
    }
  }
}

/**
 * Batch-writes an array of Queue Entry items (used by Randomizer to write randomOrder back).
 * Items should be fully formed DynamoDB item objects (unmarshalled).
 *
 * @param {object[]} items
 */
async function batchWriteEntries(items) {
  const CHUNK_SIZE = 25; // DynamoDB max
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const requests = chunk.map(item => ({
      PutRequest: { Item: marshall(item) },
    }));
    let remaining = {
      RequestItems: { [TABLE_NAME]: requests },
    };
    // Retry on UnprocessedItems
    let allWritten = false;
    for (let attempts = 0; attempts < 5; attempts++) {
      const result = await getClient().send(new BatchWriteItemCommand(remaining));
      const unprocessed = result.UnprocessedItems?.[TABLE_NAME];
      if (!unprocessed || unprocessed.length === 0) { allWritten = true; break; }
      remaining = { RequestItems: { [TABLE_NAME]: unprocessed } };
      await new Promise(resolve => setTimeout(resolve, 100 * (attempts + 1)));
    }
    if (!allWritten) {
      const leftover = remaining.RequestItems[TABLE_NAME].length;
      throw new Error(`batchWriteEntries: ${leftover} item(s) still unprocessed after 5 retries`);
    }
  }
}

module.exports = {
  TABLE_NAME,
  buildQueueId,
  buildEntrySk,
  // Queue Meta
  getQueueMeta,
  createQueueMeta,
  putQueueMeta,
  updateQueueMetaStatus,
  updateQueueMetaLastReleasedAt,
  incrementQueueTotalEntries,
  incrementAdmittedCount,
  decrementAdmittedCount,
  incrementAbandonedCount,
  deleteQueueMeta,
  // Queue Entry
  getQueueEntry,
  putQueueEntry,
  updateQueueEntryStatus,
  abandonQueueEntry,
  setDisconnectedAt,
  setConnectionId,
  setEntryAdmitting,
  setEntryAdmitted,
  // Queries
  queryQueueEntries,
  queryEntriesByCognitoSub,
  queryEntriesByClientIp,
  // Scans
  scanQueuesByStatus,
  scanAllQueueMetas,
  scanExpiredEntries,
  // Batch
  batchWriteEntries,
  batchDeleteItems,
  // Connection records (WebSocket)
  putConnectionRecord,
  getConnectionRecord,
  deleteConnectionRecord,
};
