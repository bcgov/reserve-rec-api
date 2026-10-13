const {
  ApiGatewayManagementApiClient,
  DeleteConnectionCommand,
  PostToConnectionCommand,
} = require('@aws-sdk/client-apigatewaymanagementapi');
const { logger } = require('/opt/base');
const dynamodb = require('/opt/dynamodb');
const { TOPICS } = require('./topics');
const { metaKey, topicKey, isExpired, removeConnection } = require('./store');

const BATCH_GET_MAX = 100;
const tableName = () => process.env.ADMIN_REALTIME_TABLE_NAME;

let managementClient;
function getManagementClient() {
  managementClient ??= new ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_MANAGEMENT_ENDPOINT });
  return managementClient;
}

const isGone = (err) => err?.name === 'GoneException' || err?.$metadata?.httpStatusCode === 410;

/** Connection ids subscribed to `topic`. */
async function subscribers(topic) {
  const { items } = await dynamodb.runQuery({
    TableName: tableName(),
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: { ':pk': { S: topicKey(topic, '').pk } },
  }, null, null, false);
  return items.map((item) => item.connectionId);
}

async function loadMetas(connectionIds) {
  const metas = new Map();
  for (let i = 0; i < connectionIds.length; i += BATCH_GET_MAX) {
    const chunk = connectionIds.slice(i, i + BATCH_GET_MAX);
    const idByPk = new Map(chunk.map((id) => [metaKey(id).pk, id]));
    const items = await dynamodb.batchGetData(chunk.map(metaKey), tableName());
    if (items?.unprocessedKeys) throw new Error('BatchGetItem left unprocessed keys');
    for (const item of items ?? []) metas.set(idByPk.get(item.pk), item);
  }
  return metas;
}

async function closeExpired(connectionId) {
  try {
    await getManagementClient().send(new DeleteConnectionCommand({ ConnectionId: connectionId }));
  } catch (err) {
    if (!isGone(err)) logger.warn('Expired realtime connection not closed', { connectionId, error: err?.name });
  }
  try {
    await removeConnection(connectionId);
  } catch (err) {
    logger.warn('Expired realtime connection rows not deleted', { connectionId, error: err?.name });
  }
}

// Per-connection failures are counted, never thrown: a retry cannot target one recipient and would resend to all.
async function send(connectionId, payload, meta) {
  try {
    await getManagementClient().send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: payload }));
    logger.info('event=realtime_message_sent', { ...meta, connectionId });
    return 'sent';
  } catch (err) {
    if (isGone(err)) {
      await removeConnection(connectionId).catch((e) => logger.warn('Gone realtime connection rows not deleted', { connectionId, error: e?.name }));
      return 'gone';
    }
    logger.warn('event=realtime_send_failed', { ...meta, connectionId, error: err?.name });
    return 'failed';
  }
}

/**
 * Send `event` ({ type, id, collectionId?, data?, at? }) to every live connection
 * subscribed to `topic` that passes the topic's audience check. Throws only when
 * the subscription rows cannot be read (or the topic is not in TOPICS).
 * `ids` skips the subscriber read when the caller has just done it.
 * Returns { sent, failed, gone, expired }.
 */
async function publish(topic, event, ids) {
  if (!Object.hasOwn(TOPICS, topic)) throw new Error(`Unknown realtime topic: ${topic}`);
  const def = TOPICS[topic];
  const counts = { sent: 0, failed: 0, gone: 0, expired: 0 };

  ids ??= await subscribers(topic);
  if (!ids.length) return counts;

  const recipients = [];
  const expired = [];
  for (const [id, meta] of await loadMetas(ids)) {
    if (isExpired(meta)) expired.push(id);
    else if (def.audience(event, meta.permissions ?? {})) recipients.push(id);
  }

  const payload = JSON.stringify({
    v: 1,
    topic,
    type: event.type,
    id: event.id,
    at: event.at ?? Date.now(),
    ...(event.collectionId && { collectionId: event.collectionId }),
    ...(event.data !== undefined && { data: event.data }),
  });
  const meta = { topic, type: event.type, id: event.id, collectionId: event.collectionId };
  const [results] = await Promise.all([
    Promise.all(recipients.map((id) => send(id, payload, meta))),
    Promise.all(expired.map(closeExpired)),
  ]);
  for (const result of results) counts[result]++;
  counts.expired = expired.length;
  return counts;
}

module.exports = { publish, subscribers };
