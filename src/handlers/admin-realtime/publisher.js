const { logger } = require('/opt/base');
const dynamodb = require('/opt/dynamodb');
const { TOPICS } = require('./topics');
const { publish, subscribers } = require('./publish');

// Table name -> source name, set by the stack for every stream this consumer reads.
const SOURCE_BY_TABLE = JSON.parse(process.env.REALTIME_SOURCES);

// arn:aws:dynamodb:<region>:<account>:table/<name>/stream/<label>
const tableOf = (eventSourceARN) => eventSourceARN?.split(':')[5]?.split('/')[1];

async function publishRecord(record, source) {
  for (const [topic, def] of Object.entries(TOPICS)) {
    if (def.source !== source) continue;
    // Checked first so records cost no source-table reads while nobody is subscribed.
    const ids = await subscribers(topic);
    if (!ids.length) continue;

    const event = await def.resolve(record, dynamodb);
    if (!event) continue;

    const approxSeconds = record.dynamodb?.ApproximateCreationDateTime;
    await publish(topic, { ...event, at: approxSeconds ? approxSeconds * 1000 : Date.now() }, ids);
  }
}

// Stops at the first failed record: the stream retries from the lowest failed sequence
// number, so publishing the records after it now would only duplicate those messages.
exports.handler = async (event) => {
  for (const record of event?.Records ?? []) {
    const table = tableOf(record.eventSourceARN);
    const source = Object.hasOwn(SOURCE_BY_TABLE, table) ? SOURCE_BY_TABLE[table] : undefined;
    if (!source) {
      logger.warn('Realtime publisher skipped a record from an unmapped table', { table, eventID: record.eventID });
      continue;
    }
    try {
      await publishRecord(record, source);
    } catch (err) {
      // Logged per failed attempt: each stream retry of the same record counts again.
      logger.error('event=realtime_publish_failed', {
        eventID: record.eventID,
        sequenceNumber: record.dynamodb?.SequenceNumber,
        error: err?.name,
        message: err?.message,
      });
      return { batchItemFailures: [{ itemIdentifier: record.dynamodb?.SequenceNumber }] };
    }
  }
  return { batchItemFailures: [] };
};
