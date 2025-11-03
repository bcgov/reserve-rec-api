const { logger, sendMessage, sendResponse } = require('/opt/base');
const { batchWriteData, marshall, unmarshall, USER_ID_PARTITION, runQuery } = require('/opt/dynamodb');
const { OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME, bulkWriteDocuments } = require('/opt/opensearch');
const API_STAGE = process.env.API_STAGE;
const WEBSOCKET_URL = process.env.WEBSOCKET_URL;

// These are the schemas that we want to transfer to OpenSearch transactional data index
const schemasTransferrable = [
  'booking'
];


exports.handler = async function (event, context) {
  logger.info('Transactional Data Stream Handler');
  logger.debug(JSON.stringify(event));
  try {
    let transDataIndexUpsertDocs = [];
    let transDataIndexDeleteDocs = [];

    for (const record of event?.Records) {
      const eventName = record.eventName;
      let newImage = record.dynamodb.NewImage;
      let oldImage = record.dynamodb.OldImage;

      let createDate = new Date(0);
      createDate.setUTCSeconds(record.dynamodb.ApproximateCreationDateTime);
      const creationTime = createDate.toISOString();

      const gsipk = record.dynamodb.Keys.pk;
      const schema = newImage?.schema?.S;

      // Check if schema should go to reference data index
      const isTransDataSchema = schemasTransferrable.includes(schema);

      // If the schema is not in any list of schemas to transfer, skip
      // TODO: We may want to revisit this later for admin purposes
      if (!isTransDataSchema && eventName !== 'REMOVE') {
        logger.debug(`Skipping schema ${schema} - not in list of schemas to transfer`);
        continue;
      }

      // This forms the primary key in opensearch so we can reference it later to update/remove if need be
      const openSearchId = `${record.dynamodb.Keys.pk.S}#${record.dynamodb.Keys.sk.S}`;

      logger.info(`openSearchId:${JSON.stringify(openSearchId)}, schema:${schema}, targetIndex:${OPENSEARCH_REFERENCE_DATA_INDEX_NAME}`);

      switch (record.eventName) {
        case 'MODIFY':
        case 'INSERT': {
          // Upsert document (update if exists, create if not).
          const doc = {
            ...unmarshall(newImage),
          };
          doc['id'] = openSearchId;

          // put doc by index, based on schema
          transDataIndexUpsertDocs.push(doc);
          logger.debug(JSON.stringify(doc));
        } break;
        case 'REMOVE': {
          // Remove it from the index
          const doc = {
            id: openSearchId,
          };

          // put doc by index, based on schema
          transDataIndexDeleteDocs.push(doc);
          logger.debug(JSON.stringify(doc));
        }
      }
    }

    // Process transactional data index documents
    if (transDataIndexDeleteDocs.length > 0) {
      logger.debug(`Deleting ${transDataIndexDeleteDocs.length} documents from ${OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME}`);
      await bulkWriteDocuments(transDataIndexDeleteDocs, OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME, 'delete');
    }
    if (transDataIndexUpsertDocs.length > 0) {
      logger.debug(`Writing ${transDataIndexUpsertDocs.length} documents to ${OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME}`);
      await bulkWriteDocuments(transDataIndexUpsertDocs, OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME);
    }

    // await sendToAllConnections();
    return sendResponse(200, [], `Transactional Data Stream processing complete.`, null, context);
  } catch (e) {
    logger.error(JSON.stringify(e));
    return sendResponse(500, [], 'Error processing Transactional Data stream.', e?.message, context);
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
// async function sendToAllConnections() {
//   const item = {
//     TableName: PUBSUB_TABLE_NAME,
//     KeyConditionExpression: 'pk = :pk',
//     ExpressionAttributeValues: {
//       ':pk': { S: 'websocket' }
//     }
//   };

//   try {
//     const result = await runQuery(item);
//     logger.debug('result:', JSON.stringify(result));
//     const message = "Testing message";
//     for (const record of result.items) {
//       logger.debug("record:", record);
//       const connectionId = record.sk;
//       logger.debug("Sending to connectionId:", connectionId);
//       logger.debug("WEBSOCKET_URL:", WEBSOCKET_URL);
//       logger.debug("API_STAGE:", API_STAGE);
//       logger.debug("message:", message);

//       // If the WebSocket URL is using wss, we need to change it to https
//       let wsURL = WEBSOCKET_URL;
//       if (wsURL.startsWith('wss')) {
//         wsURL = wsURL.replace('wss', 'https');
//         await sendMessage(connectionId, wsURL, API_STAGE, message);
//       } else {
//         await sendMessage(connectionId, wsURL, API_STAGE, message);
//       }
//     }
//   } catch (error) {
//     logger.error(`Error querying connection item: ${JSON.stringify(error)}`);
//     throw error;
//   }
// }
