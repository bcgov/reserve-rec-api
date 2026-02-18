/**
 * User Search/List Handler
 * 
 * Searches OpenSearch transactional-data-index for users (filtered by schema='user')
 * When query/text is provided: Full-text search across email, name, phone number, license plate fields
 * When query/text is empty/omitted: Returns all users (sorted, paginated)
 * 
 * Authorization: Admin users (via API Gateway authorizer)
 */

const { logger, sendResponse } = require('/opt/base');
const { OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME, OSQuery } = require('/opt/opensearch');

exports.handler = async function (event, context) {
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    const body = JSON.parse(event?.body) || {};
    const {
      query: userQuery,
      text,
      size = 20,
      from = 0,
      sortField = 'createdAt',
      sortOrder = 'desc',
      limit,
      ...filters
    } = body;

    const searchText = userQuery || text;

    let query = new OSQuery(OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME, {
      size,
      from,
      sortField,
      sortOrder,
    });

    // only search the user schema
    query.addFilterTermsRule({ schema: 'user' }, true);

    // If search text is provided do the search, otherwise return all users (with pagination)
    if (searchText) {
      const searchQuery = {
        bool: {
          should: [
            {
              multi_match: {
                query: searchText,
                fields: ['email^3', 'givenName^2', 'familyName^2', 'phoneNumber', 'mobilePhone', 'licensePlate'],
                type: 'best_fields',
                fuzziness: 'AUTO'
              }
            },
            // Make them wildcard and insensitive 
            { wildcard: { 'email.keyword': { value: `*${searchText}*`, case_insensitive: true } } },
            { wildcard: { 'givenName.keyword': { value: `*${searchText}*`, case_insensitive: true } } },
            { wildcard: { 'familyName.keyword': { value: `*${searchText}*`, case_insensitive: true } } },
            { wildcard: { phoneNumber: { value: `*${searchText}*`, case_insensitive: true } } },
            { wildcard: { mobilePhone: { value: `*${searchText}*`, case_insensitive: true } } },
            { wildcard: { licensePlate: { value: `*${searchText}*`, case_insensitive: true } } }
          ],
          minimum_should_match: 1
        }
      };
      
      // Add search as a must clause (schema filter already exists from addFilterTermsRule above)
      query.query.bool.must = [searchQuery];
    }

    if (Object.keys(filters).length > 0) {
      query.addFilterTermsRule(filters, true);
    }

    const response = await query.search();
    const hits = response.body.hits.hits.map(hit => ({
      ...hit._source,
      _id: hit._id,
      _score: hit._score,
    }));

    return sendResponse(200, {
      hits,
      total: response.body.hits.total.value,
      max_score: response.body.hits.max_score,
    }, 'Success', null, context);

  } catch (err) {
    logger.error('User search error:', err);
    return sendResponse(
      err?.code || 400, 
      [], 
      err?.msg || 'Error searching users', 
      err?.error || err, 
      context
    );
  }
};
