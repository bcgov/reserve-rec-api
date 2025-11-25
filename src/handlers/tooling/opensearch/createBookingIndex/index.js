/**
 * Create the booking index for the OpenSearch cluster with the appropriate mappings.
 */

const { sendResponse, logger } = require('/opt/base');
const { OPENSEARCH_BOOKING_INDEX, checkIndex, createIndex, deleteIndex, listIndices } = require('/opt/opensearch');

const bookingIndexMappingOptions = {
  properties: {
    bookingId: { type: 'keyword' },
    globalId: { type: 'keyword' },
    startDate: { type: 'date', format: 'yyyy-MM-dd||yyyy-MM-dd\'T\'HH:mm:ss\'Z\'||yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'' },
    endDate: { type: 'date', format: 'yyyy-MM-dd||yyyy-MM-dd\'T\'HH:mm:ss\'Z\'||yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'' },
    displayName: { 
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    bookingStatus: { type: 'keyword' },
    bookedAt: { type: 'date' },
    userId: { type: 'keyword' },
    activityType: { type: 'keyword' },
    activityId: { type: 'keyword' },
    collectionId: { type: 'keyword' },
    sessionId: { type: 'keyword' },
    rateClass: { type: 'keyword' },
    timezone: { type: 'keyword' },
    
    // Complex objects
    entryPoint: { type: 'object' },
    exitPoint: { type: 'object' },
    namedOccupant: { type: 'object' },
    partyInformation: { type: 'object' },
    feeInformation: { type: 'object' },
    vehicleInformation: { type: 'text' },
    equipmentInformation: { type: 'text' },
    
    // Geospatial
    location: { type: 'geo_point' },
    
    // Search fields
    searchTerms: { type: 'text' },
    
    // Metadata
    schema: { type: 'keyword' },
    version: { type: 'integer' },
    lastUpdated: { type: 'date' },
    pk: { type: 'keyword' },
    sk: { type: 'keyword' }
  }
};

exports.handler = async (event, context) => {
  logger.debug('Create OpenSearch Booking Index', event);
  try {

    // Get body
    const body = JSON.parse(event?.body || '{}');
    const deleteOldIndex = body?.deleteOldIndex || false;

    const indexList = await listIndices();
    logger.debug('Available Indexes:', indexList?.body.map(i => i?.index));

    let exists = await checkIndex(OPENSEARCH_BOOKING_INDEX);

    // Delete the old index if it exists and it is required
    if (exists?.statusCode === 200 && deleteOldIndex) {
      logger.info(`Deleting old index '${OPENSEARCH_BOOKING_INDEX}'`);
      await deleteIndex(OPENSEARCH_BOOKING_INDEX);
      logger.info(`Deleted old index: ${OPENSEARCH_BOOKING_INDEX}`);
    }

    // Create new index if it doesn't exist
    exists = await checkIndex(OPENSEARCH_BOOKING_INDEX);
    if (exists?.statusCode === 404) {
      // Index doesn't exist
      logger.info(`Creating index '${OPENSEARCH_BOOKING_INDEX}'`);
      const createdIndex = await createIndex(OPENSEARCH_BOOKING_INDEX, bookingIndexMappingOptions);
      return sendResponse(200, [], `Created new index: ${OPENSEARCH_BOOKING_INDEX}`, null, context);
    }
    return sendResponse(200, [], `Index already exists: ${OPENSEARCH_BOOKING_INDEX}`, null, context);

  } catch (err) {
    logger.error(err);
    return sendResponse(400, [], 'Error', err, context);
  }
};
