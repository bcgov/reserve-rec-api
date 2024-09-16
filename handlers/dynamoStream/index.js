const { logger } = require('/opt/base');
const { batchWriteData, AUDIT_TABLE_NAME, marshall, unmarshall } = require('/opt/dynamodb');
const { OPENSEARCH_MAIN_INDEX, client } = require('/opt/opensearch');


exports.handler = async function (event, context) {
  logger.info('Stream Handler');
  logger.debug(event);
  try {
    let auditRecordsToCreate = [];
    for (const record of event?.Records) {
      const eventName = record.eventName;
      let newImage = record.dynamodb.NewImage;
      let oldImage = record.dynamodb.OldImage;

      let createDate = new Date(0);
      createDate.setUTCSeconds(record.dynamodb.ApproximateCreationDateTime);
      const creationTime = createDate.toISOString();

      const gsipk = record.dynamodb.Keys.pk;
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

      let upsertDocs = [];
      let deleteDocs = [];

      switch (record.eventName) {
        case 'MODIFY':
        case 'INSERT': {
          // Upsert document (update if exists, create if not).
          const doc = {
            ...unmarshall(newImage),
          };
          doc['id'] = openSearchId;

          upsertDocs.push(doc);
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
    await client.helper.bulk({
      datasource: deleteDocs,
      refreshOnCompletion: true, // Refresh the index after the operation
      onDocument(doc) {
        return [
          { delete: { _id: doc.id, _index: OPENSEARCH_MAIN_INDEX } }
        ];
      }
    });

    // Upsert docs to update
    await client.helper.bulk({
      datasource: upsertDocs,
      refreshOnCompletion: true, // Refresh the index after the operation
      onDocument(doc) {
        return [
          {
            update: {
              _id: doc.id,
              _index: OPENSEARCH_MAIN_INDEX
            }
          },
          {
            doc_as_upsert: true
          }
        ];
      }
    });

    // Write it all out to the Audit table
    logger.info(`Writing batch data`);
    await batchWriteData(auditRecordsToCreate, 25, AUDIT_TABLE_NAME);
  } catch (e) {
    console.log(e);
    logger.error(JSON.stringify(e));
  }
};