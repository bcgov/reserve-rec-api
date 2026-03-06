'use strict';

const { Exception, logger, sendResponse } = require('/opt/base');
const { getQueueMeta, queryQueueEntries, deleteQueueMeta, batchDeleteItems } = require('../utils/dynamodb');

const SAFE_TO_DELETE_STATUSES = ['pre-open', 'closed'];

exports.handler = async (event) => {
  logger.info('WaitingRoom admin DELETE-QUEUE');

  try {
    const queueId = event?.pathParameters?.queueId
      ? decodeURIComponent(event.pathParameters.queueId)
      : null;

    if (!queueId) {
      throw new Exception('Missing path parameter: queueId', { code: 400 });
    }

    const meta = await getQueueMeta(queueId);
    if (!meta) {
      throw new Exception('Queue not found', { code: 404 });
    }

    if (!SAFE_TO_DELETE_STATUSES.includes(meta.queueStatus)) {
      throw new Exception(
        `Cannot delete queue in status '${meta.queueStatus}'. Close it first.`,
        { code: 409 }
      );
    }

    // Delete all entries for this queue
    const entries = await queryQueueEntries(queueId);
    if (entries.length > 0) {
      const keys = entries.map(e => ({ pk: e.pk, sk: e.sk }));
      await batchDeleteItems(keys);
    }

    // Delete the META record
    await deleteQueueMeta(queueId);

    logger.info(`Deleted queue ${queueId} (${entries.length} entries removed)`);

    return sendResponse(200, { deleted: true, queueId, entriesRemoved: entries.length }, 'Queue deleted');

  } catch (err) {
    if (err instanceof Exception || err.code) {
      return sendResponse(err.code || 500, null, err.message, err);
    }
    logger.error('WaitingRoom DELETE-QUEUE error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
