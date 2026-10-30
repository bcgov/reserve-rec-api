const { Exception, logger, sendResponse } = require('/opt/base');
const {
  batchTransactData,
  getOneByGlobalId,
  marshall,
  TRANSACTIONAL_DATA_TABLE_NAME,
} = require('/opt/dynamodb');

/**
 * @api {put} /migrate/{migrateId} PUT
 * Update a migrationHold
 */
exports.handler = async (event, context) => {
  try {
    const migrateId = event?.pathParameters?.migrateId;
    if (!migrateId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(migrateId)) {
      throw new Exception('A valid migrateId is required', { code: 400 });
    }

    const migrateHold = await getOneByGlobalId(migrateId, TRANSACTIONAL_DATA_TABLE_NAME);

    // No hold found
    if (!migrateHold) {
      throw new Exception('Migration not initialized. Please sign in again to restart the process.', { code: 404 });
    }

    // Missing required information in the hold
    if (migrateHold.pk !== 'migrateHold' || !migrateHold.oldParksSub || !migrateHold.newBcscUsername) {
      throw new Exception('Migration request is invalid. Please sign in again to restart the process.', { code: 404 });
    }

    // Migration completed
    if (migrateHold.status === 'confirmed' || migrateHold.status === 'completed') {
      return sendResponse(200, { status: migrateHold.status }, 'Migration already confirmed', null, context);
    }

    // Migration is anything else but pending
    if (migrateHold.status !== 'pending') {
      throw new Exception('This migration can no longer be confirmed. Please sign in again.', { code: 409 });
    }

    // Migration has expired
    if (!Number.isFinite(migrateHold.holdExpiry) || migrateHold.holdExpiry <= Date.now()) {
      throw new Exception('Migration window has expired. Please sign in again to restart the process.', { code: 410 });
    }

    const now = Date.now();
    const migrateUpdate = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: {
        pk: marshall(migrateHold.pk),
        sk: marshall(migrateHold.sk),
      },
      UpdateExpression: 'SET #status = :confirmed, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#updatedAt': 'updatedAt',
        '#holdExpiry': 'holdExpiry',
      },
      ExpressionAttributeValues: {
        ':confirmed': { S: 'confirmed' },
        ':updatedAt': { N: String(now) },
        ':pending': { S: 'pending' },
        ':now': { N: String(now) },
      },
      ConditionExpression: '#status = :pending AND #holdExpiry > :now',
    };

    try {
      await batchTransactData([{ data: migrateUpdate, action: 'Update' }]);
    } catch (error) {
      if (error?.name !== 'TransactionCanceledException') throw error;

      // Try again?
      const currentHold = await getOneByGlobalId(migrateId, TRANSACTIONAL_DATA_TABLE_NAME);
      if (currentHold?.status === 'confirmed' || currentHold?.status === 'completed') {
        return sendResponse(200, { status: currentHold.status }, 'Migration already confirmed', null, context);
      }
      if (currentHold?.status === 'pending' && currentHold.holdExpiry <= Date.now()) {
        throw new Exception('Migration window has expired. Please sign in again to restart the process.', { code: 410 });
      }
      throw new Exception('Migration could not be confirmed. Please try again.', { code: 409 });
    }

    return sendResponse(200, { status: 'confirmed' }, 'Migration confirmed', null, context);
  } catch (error) {
    logger.error('Migration confirmation failed', { message: error?.message });
    return sendResponse(
      Number(error?.code) || 500,
      error?.data || null,
      error?.message || 'Unable to confirm migration. Please try again.',
      error?.error || null,
      context
    );
  }
};
