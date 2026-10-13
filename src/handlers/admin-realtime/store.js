'use strict';

const { DynamoDBClient, PutItemCommand, DeleteItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { TOPICS } = require('./topics');

// Shared by the admin realtime route handlers: AdminRealtimeTable access,
// control replies and message parsing.

const TTL_SECONDS = 3 * 60 * 60;

let client;
const ddb = () => (client ??= new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }));
const tableName = () => process.env.ADMIN_REALTIME_TABLE_NAME;

const metaKey = (connectionId) => ({ pk: `CONN#${connectionId}`, sk: 'META' });
const topicKey = (topic, connectionId) => ({ pk: `TOPIC#${topic}`, sk: `CONN#${connectionId}` });
const expiresAt = () => Math.floor(Date.now() / 1000) + TTL_SECONDS;
// Missing exp counts as expired: a connection must carry its token's expiry to act or receive anything.
const isExpired = (meta) => !(Number(meta.exp) * 1000 > Date.now());

const putRow = (item) => ddb().send(new PutItemCommand({ TableName: tableName(), Item: marshall(item) }));
const deleteRow = (key) => ddb().send(new DeleteItemCommand({ TableName: tableName(), Key: marshall(key) }));

/** Delete a row and return what it held, or null if it was already gone. */
async function takeRow(key) {
  const res = await ddb().send(new DeleteItemCommand({ TableName: tableName(), Key: marshall(key), ReturnValues: 'ALL_OLD' }));
  return res.Attributes ? unmarshall(res.Attributes) : null;
}

/**
 * Remove a connection's META row and its row under every known topic. Deletes
 * are unconditional, so topics it never joined cost a no-op. Returns the old
 * META or null.
 */
async function removeConnection(connectionId) {
  const [meta] = await Promise.all([
    takeRow(metaKey(connectionId)),
    ...Object.keys(TOPICS).map(topic => deleteRow(topicKey(topic, connectionId))),
  ]);
  return meta;
}

// Control replies go back as the route response (the routes set returnResponse).
const reply = (message) => ({ statusCode: 200, body: JSON.stringify(message) });

/**
 * Read `topic` from the message body. Returns { topic } for a registered topic,
 * else { error } with the control-reply code.
 */
function readTopic(event) {
  let topic;
  try {
    topic = JSON.parse(event.body || '{}').topic;
  } catch {
    return { error: 'bad_request' };
  }
  if (typeof topic !== 'string') return { error: 'bad_request' };
  if (!Object.hasOwn(TOPICS, topic)) return { error: 'unknown_topic' };
  return { topic };
}

module.exports = {
  tableName, metaKey, topicKey, expiresAt, isExpired, putRow, deleteRow,
  removeConnection, reply, readTopic,
};
