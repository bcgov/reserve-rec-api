// Import necessary libraries and modules
const { OSQuery, OPENSEARCH_REFERENCE_DATA_INDEX_NAME, nonKeyableTerms } = require('/opt/opensearch');
const { sendResponse, logger, Exception } = require('/opt/base');

// Lambda function entry point
exports.handler = async function (event, context) {
  logger.debug('Search:', event); // Log the search event
  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  try {
    // Extract query parameters from the event
    const body = JSON.parse(event?.body) || {};
    const userQuery = body?.text;

    // Construct the search query
    let query = new OSQuery(OPENSEARCH_REFERENCE_DATA_INDEX_NAME, body);

    // Text search
    if (userQuery) {
      query.addMatchQueryStringRule(body?.text);
    }

    // Term filtering
    let termQuery = { ...body };
    for (const term in termQuery) {
      if (nonKeyableTerms.indexOf(term) > -1) {
        delete termQuery[term];
      }
    }

    query.addFilterTermsRule(termQuery, true);

    // Send the query to the OpenSearch cluster
    let response = await query.search();
    logger.debug('Request:', query.request); // Log the request (available after sending)
    logger.debug('Response:', response); // Log the response

    // Send a success response
    return sendResponse(200, response?.body?.hits, 'Success', null, context);
  } catch (err) {
    logger.error(JSON.stringify(err)); // Log the error

    // Send an error response
    return sendResponse(err?.code || 400, [], err?.msg || 'Error', err?.error || err, context);
  }
};
