// Import necessary libraries and modules
const { OSQuery, OPENSEARCH_MAIN_INDEX, nonKeyableTerms } = require('/opt/opensearch');
const { sendResponse, logger, Exception } = require('/opt/base');
const { permitPipeline } = require('./pipelines');
// Lambda function entry point
exports.handler = async function (event, context) {
  logger.debug('Search:', event); // Log the search event
  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  try {
    // Extract query parameters from the event
    const queryParams = event.queryStringParameters;

    const userQuery = queryParams?.text;

    // Construct the search query
    let permitQuery = new OSQuery(OPENSEARCH_MAIN_INDEX, {
      size: queryParams?.limit,
      from: queryParams?.startFrom,
      pipeline: permitPipeline
    });

    // Text search
    if (userQuery) {
      permitQuery.addMatchQueryStringRule(queryParams?.text);
    }

    // Term filtering
    let permitFilterTerms = { ...queryParams };
    for (const term in permitFilterTerms) {
      if (nonKeyableTerms.indexOf(term) > -1) {
        delete permitFilterTerms[term];
      }
    }
    // Also remove date range terms
    delete permitFilterTerms.startDate;
    delete permitFilterTerms.endDate;

    permitQuery.addFilterTermsRule(permitFilterTerms, true);

    let results = [];

    // Get first pass at the query
    // Send the query to the OpenSearch cluster
    let foundPermits = await permitQuery.search();
    logger.debug('Permit Request:', permitQuery.request); // Log the request (available after sending)
    logger.debug('Permit Response:', foundPermits); // Log the response
    console.log('Permit Request:', permitQuery.request); // Log the request (available after sending)
    console.log('Permit Response:', foundPermits); // Log the response

    // If we care about operational dates, then for each permit found, we need to search for its operational date data.
    // We can construct another OS query to do this.
    // The operational date's parent should be the pk/sk of the permit, so we can filter on that.
    // We will also ensure the type is opDate.
    // We can also filter on the date range.
    // if (queryParams?.startDate && queryParams?.endDate) {
    //   let permits = foundPermits?.body?.hits?.hits || [];
    //   console.log('permits.length:', permits.length);
    //   // Construct the search query
    //   let opDateQuery = new OSQuery(OPENSEARCH_MAIN_INDEX, queryParams?.limit, queryParams?.startFrom);

    //   let opDateFilterTerms = {
    //     // type: 'opDate',
    //     ['parent.pk']: permits.map(permit => permit._id.split("#")[0]).join(',')
    //   };

    //   console.log('opDateFilterTerms:', opDateFilterTerms);

    //   opDateQuery.addFilterTermsRule(opDateFilterTerms, true);
    //   console.log('1');
    //   console.log('2');
    //   // opDateQuery.addRangeQueryRule('date', queryParams?.startDate, queryParams?.endDate);

    //   console.log('opDateQuery:', JSON.stringify(opDateQuery, null, 2));

    //   let foundOpDates = await opDateQuery.search();
    //   logger.debug('Permit Request:', JSON.stringify(opDateQuery.request)); // Log the request (available after sending)
    //   logger.debug('Permit Response:', JSON.stringify(foundOpDates)); // Log the response
    //   console.log('Permit Request:', JSON.stringify(opDateQuery.request)); // Log the request (available after sending)
    //   console.log('Permit Response:', JSON.stringify(foundOpDates)); // Log the response

    // }

    // Send a success response
    return sendResponse(200, foundPermits.body.hits, 'Success', null, context);
  } catch (err) {
    logger.error(JSON.stringify(err)); // Log the error

    // Send an error response
    return sendResponse(err?.code || 400, [], err?.msg || 'Error', err?.error || err, context);
  }
};