/**
 * Create the booking index for the OpenSearch cluster with the appropriate mappings.
 */

const { sendResponse, logger } = require('/opt/base');
const { checkIndex, createIndex, deleteIndex, listIndices } = require('/opt/opensearch');
const indexMappingOptions = require('./indexMappingOptions');

const OPENSEARCH_REFERENCE_DATA_INDEX_NAME = process.env.OPENSEARCH_REFERENCE_DATA_INDEX_NAME || 'reference-data-index';
const OPENSEARCH_BOOKING_INDEX_INDEX_NAME = process.env.OPENSEARCH_BOOKING_INDEX_INDEX_NAME || 'booking-index';

const indexes = [
  {
    key: 'referenceData',
    name: OPENSEARCH_REFERENCE_DATA_INDEX_NAME,
    mapping: indexMappingOptions.refDataIndexMappingOptions,
  },
  {
    key: 'booking',
    name: OPENSEARCH_BOOKING_INDEX_INDEX_NAME,
    mapping: indexMappingOptions.refDataIndexMappingOptions,
  }
]

exports.handler = async (event, context) => {
  logger.debug('Create OpenSearch Indexes', event);
  try {

    // Get body
    const body = JSON.parse(event?.body || '{}');
    const indexKey = body?.indexKey;
    const deleteOldIndex = body?.deleteOldIndex || false;

    const indexList = await listIndices();
    logger.debug('Available Indexes:', indexList?.body.map(i => i?.index));

    const indexConfig = indexes.find(i => i.key === indexKey);

    if (!indexKey || !indexConfig) {
      throw new Error(`Invalid indexKey '${indexKey}' provided. Valid values are: ` + indexes.map(i => i.key).join(', '));
    }

    let exists = await checkIndex(indexConfig.name);

    // Delete the old index if it exists and it is required
    if (exists?.statusCode === 200 && deleteOldIndex) {
      logger.info(`Deleting old index '${indexConfig.name}'`);
      await deleteIndex(indexConfig.name);
      logger.info(`Deleted old index: ${indexConfig.name}`);
    }

    // Create new index if it doesn't exist
    exists = await checkIndex(indexConfig.name);
    if (exists?.statusCode === 404) {
      // Index doesn't exist
      logger.info(`Creating index '${indexConfig.name}'`);
      const createdIndex = await createIndex(indexConfig.name, indexConfig.mapping);
      return sendResponse(200, [], `Created new index: ${indexConfig.name}`, null, context);
    }
    return sendResponse(200, [], `Index already exists: ${indexConfig.name}`, null, context);

  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};
