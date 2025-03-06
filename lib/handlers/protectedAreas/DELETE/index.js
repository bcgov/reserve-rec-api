const { Exception, logger, sendResponse } = require("/opt/base");
const { TABLE_NAME, marshall, batchTransactData } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  logger.info('Batch Delete Protected Areas by ORCS', event);
  try {
    const body = JSON.parse(event?.body);
    if (!body) {
      throw new Exception('Body is required', { code: 400 });
    }

    if (!Array.isArray(body)) {
      throw new Exception('Body must be an array', { code: 400 });
    }

    let deleteItems = [];
    for (const item of body) {
      if (!item?.sk) {
        throw new Exception('sk', { code: 400 });
      }

      const pk = 'protectedArea';
      const sk = item.sk;

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
