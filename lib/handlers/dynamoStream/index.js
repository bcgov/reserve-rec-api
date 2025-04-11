const { logger, sendMessage } = require('/opt/base');
const { batchWriteData, AUDIT_TABLE_NAME, marshall, unmarshall, USER_ID_PARTITION, runQuery, PUBSUB_TABLE_NAME } = require('/opt/dynamodb');
const { OPENSEARCH_MAIN_INDEX, bulkWriteDocuments, OPENSEARCH_DOMAIN_NAME } = require('/opt/opensearch');
const API_STAGE = process.env.API_STAGE;
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;

// These are the schemas that we want to transfer to OpenSearch
const schemasTransferrable = [
  'protectedArea',
  'geozone',
  'facility',
  'activity',
  'product'
];

exports.handler = async function (event, context) {
  logger.info('Stream Handler');
  logger.debug(JSON.stringify(event));
  try {
    let auditRecordsToCreate = [];
    let upsertDocs = [];
    let deleteDocs = [];
    for (const record of event?.Records) {
      const eventName = record.eventName;
      let newImage = record.dynamodb.NewImage;
      let oldImage = record.dynamodb.OldImage;

      let createDate = new Date(0);
      createDate.setUTCSeconds(record.dynamodb.ApproximateCreationDateTime);
      const creationTime = createDate.toISOString();

      const gsipk = record.dynamodb.Keys.pk;
      const schema = newImage?.schema?.S;

      // If pk === USER_ID_PARTITION then skip
      if (gsipk.S === USER_ID_PARTITION) {
        // TODO: Push data into either a new index and add some sort of record to the audit table.
        continue;
      }

      // If the schema is not in the list of schemas to transfer, skip
      // We only care about publicly searchable data for now.
      // TODO: This also skips the audit step, so we still need to add a record to the audit table
      if (!schemasTransferrable.includes(schema)) {
        logger.debug(`Skipping schema ${newImage} - not in list of schemas to transfer`);
        continue;
      }

      const gsisk = record.dynamodb.Keys.sk;
      const user = newImage?.lastModifiedBy?.S || "system";

      // This forms the primary key in opensearch so we can reference it later to update/remove if need be
      const openSearchId = `${record.dynamodb.Keys.pk.S}#${record.dynamodb.Keys.sk.S}`;

      logger.info(`openSearchId:${JSON.stringify(openSearchId)}`);

      const auditImage = {
        pk: marshall(user),
        sk: marshall(creationTime),
        gsipk: gsipk,
        gsisk: gsisk,
        newImage: { "M": newImage },
        oldImage: { "M": oldImage },
        operation: marshall(eventName)
      };

      logger.debug(`auditImage:${JSON.stringify(auditImage)}`);

      switch (record.eventName) {
        case 'MODIFY':
        case 'INSERT': {
          // Upsert document (update if exists, create if not).
          const doc = {
            ...unmarshall(newImage),
          };
          doc['id'] = openSearchId;

          upsertDocs.push({
            doc: doc,
            doc_as_upsert: true,
          });
          logger.debug(JSON.stringify(doc));
        } break;
        case 'REMOVE': {
          // Remove it from the index
          const doc = {
            id: openSearchId,
          };

          deleteDocs.push(doc);
          logger.debug(JSON.stringify(doc));
        }
      }
      auditRecordsToCreate.push(auditImage);
    }

    // Remove docs to delete
    await bulkWriteDocuments(deleteDocs, OPENSEARCH_MAIN_INDEX, 'delete');
    // Upsert docs to update
    await bulkWriteDocuments(upsertDocs, OPENSEARCH_MAIN_INDEX);

    // Write it all out to the Audit table
    logger.info(`Writing batch data`);
    await batchWriteData(auditRecordsToCreate, 25, AUDIT_TABLE_NAME);
    await sendToAllConnections();
  } catch (e) {
    logger.info(e);
    logger.error(JSON.stringify(e));
  }
};

/**
 * Sends a message to all WebSocket connections.
 *
 * This function queries the database for all WebSocket connections and sends a predefined message to each connection.
 *
 * @async
 * @function sendToAllConnections
 * @throws Will throw an error if querying the database or sending a message fails.
 */
async function sendToAllConnections() {
  const item = {
    TableName: PUBSUB_TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: 'websocket' }
    }
  };

  try {
    const result = await runQuery(item);
    logger.debug('result:', JSON.stringify(result));
    const message = "Testing message";
    for (const record of result.items) {
      logger.debug("record:", record);
      const connectionId = record.sk;
      logger.debug("Sending to connectionId:", connectionId);
      logger.debug("WEBSOCKET_URL:", WEBSOCKET_URL);
      logger.debug("API_STAGE:", API_STAGE);
      logger.debug("message:", message);

      // If the WebSocket URL is using wss, we need to change it to https
      let wsURL = WEBSOCKET_URL;
      if (wsURL.startsWith('wss')) {
        wsURL = wsURL.replace('wss', 'https');
        await sendMessage(connectionId, wsURL, API_STAGE, message);
      } else {
        await sendMessage(connectionId, wsURL, API_STAGE, message);
      }
    }
  } catch (error) {
    logger.error(`Error querying connection item: ${JSON.stringify(error)}`);
    throw error;
  }
}
