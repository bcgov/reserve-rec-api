const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Batch Delete Geozone IDs', event);
  try {
    const gzCollection = event?.pathParameters?.gzcollection;
    const gzCollectionId = event?.pathParameters?.gzcollectionid;
    
    if (!gzCollection) {
      throw new Exception('Geozone Collection (gzCollection) is required', { code: 400 });
    } else if (!gzCollectionId) {
      throw new Exception('Geozone Collection ID (gzCollectionId) is required', { code: 400 });
    }

    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    if (!Array.isArray(body)) {
      throw new Exception('Body must be an array', { code: 400 });
    }

    let deleteItems = [];
    for (const item of body) {

      if (!item?.identifier && !item?.geozoneId) {
        throw new Exception('identifier or geozoneID is required for every delete item', { code: 400 });
      }

      const pk = item?.pk ? item.pk : `geozone::${gzCollection}::${gzCollectionId}`;
      const sk = String(item?.sk ? item.sk : item.identifier ?? item.geozoneId);

      let deleteCommand = {
        action: 'Delete',
        data: {
          TableName: TABLE_NAME,
          Key: marshall({ pk: pk, sk: sk }),
          ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)',
        }
      };

      deleteItems.push(deleteCommand);
    }

    // Use batchTransactData to put the database
    const res = await batchTransactData(deleteItems);
    return sendResponse(200, res, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || error, context);
  }
};
