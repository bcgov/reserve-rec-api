/**
 * Create the main index for the OpenSearch cluster with the appropriate mappings.
 */

const { sendResponse, logger } = require('/opt/base');
const { OPENSEARCH_MAIN_INDEX, checkIndex, createIndex, deleteIndex, listIndices } = require('/opt/opensearch');

const mainIndexMappingOptions = {
  properties: {
    // location
    location: {
      type: 'geo_point'
    },
    // boundary
    boundary: {
      type: 'geo_shape'
    },
    // path
    path: {
      type: 'geo_shape'
    },
    // envelope
    envelope: {
      type: 'geo_shape'
    }
  }
};

exports.handler = async (event, context) => {
  logger.debug('Create OpenSearch Main Index', event);
  try {

    // Get body
    const body = JSON.parse(event?.body || '{}');
    const deleteOldIndex = body?.deleteOldIndex || false;

    const indexList = await listIndices();
    logger.debug('Available Indexes:', indexList?.body.map(i => i?.index));

    let exists = await checkIndex(OPENSEARCH_MAIN_INDEX);

    // Delete the old index if it exists and it is required
    if (exists.statusCode === 200 && deleteOldIndex) {
      logger.info(`Deleting old index '${OPENSEARCH_MAIN_INDEX}'`);
      await deleteIndex(OPENSEARCH_MAIN_INDEX);
      logger.info(`Deleted old index: ${OPENSEARCH_MAIN_INDEX}`);
    }

    // Create new index if it doesn't exist
    exists = await checkIndex(OPENSEARCH_MAIN_INDEX);
    if (exists.statusCode === 404) {
      // Index doesn't exist
      logger.info(`Creating index '${OPENSEARCH_MAIN_INDEX}'`);
      const createdIndex = await createIndex(OPENSEARCH_MAIN_INDEX, mainIndexMappingOptions);
      return sendResponse(200, [], `Created new index: ${OPENSEARCH_MAIN_INDEX}`, null, context);
    }
    return sendResponse(200, [], `Index already exists: ${OPENSEARCH_MAIN_INDEX}`, null, context);

  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};