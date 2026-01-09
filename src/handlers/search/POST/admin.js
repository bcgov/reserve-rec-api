// Import necessary libraries and modules
const {
  OSQuery,
  OPENSEARCH_REFERENCE_DATA_INDEX_NAME,
  nonKeyableTerms,
} = require("/opt/opensearch");
const { sendResponse, logger } = require("/opt/base");

// Lambda function entry point
exports.handler = async function (event, context) {
  logger.debug("Search:", event);

  // Allow CORS
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }

  try {
    // Extract query parameters from the event
    const body = JSON.parse(event?.body) || {};
    const userQuery = body?.text;

    // Handle autocomplete/suggest requests
    if (body?.suggest && userQuery) {
      logger.info("Handling suggest request");

      // Build a query with filters for suggestions
      let query = new OSQuery(OPENSEARCH_REFERENCE_DATA_INDEX_NAME, {
        ...body,
        size: body?.suggestSize || 10,
      });

      // Apply filters
      // Support both nested filters object and top-level filter fields
      let termQuery = { ...body };
      if (body.filters && typeof body.filters === "object") {
        // If filters is a nested object, merge it into termQuery
        termQuery = { ...termQuery, ...body.filters };
      }

      logger.info("termQuery filtering:", termQuery);
      // Remove non-keyable terms (like suggest, text, etc.)
      for (const term in termQuery) {
        if (nonKeyableTerms.indexOf(term) > -1) {
          delete termQuery[term];
        }
      }

      // Apply filters if any exist
      if (Object.keys(termQuery).length > 0) {
        query.addFilterTermsRule(termQuery, true);
      }

      // Use prefix query for filtered autocomplete with fuzzy matching
      const searchField =
        body?.suggestField?.replace(".suggest", "") || "searchTerms";
      const fuzziness = body?.fuzziness || "AUTO";

      // Split multi-word queries and search for ANY matching term
      const queryTerms = userQuery.trim().split(/\s+/);

      // Initialize bool structure
      if (!query.query.bool) {
        query.query.bool = {};
      }
      if (!query.query.bool.should) {
        query.query.bool.should = [];
      }

      if (queryTerms.length === 1) {
        // Single term - use both prefix (higher boost) and fuzzy (lower boost)
        // Exact prefix matches rank higher, but fuzzy matches still appear
        query.query.bool.should.push({
          match_phrase_prefix: {
            [searchField]: {
              query: userQuery,
              max_expansions: 50,
              boost: 3.0,
            },
          },
        });

        query.query.bool.should.push({
          match: {
            [searchField]: {
              query: userQuery,
              fuzziness: fuzziness,
              prefix_length: 1,
              max_expansions: 50,
              boost: 1.0,
            },
          },
        });
      } else {
        // Multiple terms - create OR query for each term with descending boost values
        // Include both prefix and fuzzy matching for each term

        queryTerms.forEach((term, index) => {
          // First term gets highest priority, subsequent terms get progressively lower priority
          const prefixBoost =
            index === 0 ? 3.0 : index === 1 ? 2.0 : index === 2 ? 1.5 : 1.0;

          const fuzzyBoost = prefixBoost * 0.5; // Fuzzy gets half the boost of prefix

          // Prefix match (exact)
          query.query.bool.should.push({
            match_phrase_prefix: {
              [searchField]: {
                query: term,
                max_expansions: 50,
                boost: prefixBoost,
              },
            },
          });

          // Fuzzy match (approximate)
          query.query.bool.should.push({
            match: {
              [searchField]: {
                query: term,
                fuzziness: fuzziness,
                prefix_length: 1,
                max_expansions: 50,
                boost: fuzzyBoost,
              },
            },
          });
        });
      }

      // Require at least one term to match
      query.query.bool.minimum_should_match = 1;

      logger.debug(
        "Suggestion query structure:",
        JSON.stringify(query.query, null, 2)
      );

      const searchResponse = await query.search();

      // Provide the display name for the suggestions
      const suggestions = searchResponse.body.hits.hits.map((hit) => ({
        text: hit._source.displayName,
        score: hit._score,
        _source: hit._source,
      }));

      return sendResponse(200, suggestions, "Success", null, context);
    }

    // Construct the search query
    let query = new OSQuery(OPENSEARCH_REFERENCE_DATA_INDEX_NAME, body);

    // Text search with optional fuzzy matching
    if (userQuery) {
      if (body?.fuzzy) {
        // Use fuzzy matching for approximate search
        query.addFuzzyMatchRule("searchTerms", userQuery, {
          fuzziness: body?.fuzziness || "AUTO",
          prefixLength: body?.fuzzyPrefixLength || 0,
          maxExpansions: body?.fuzzyMaxExpansions || 50,
        });
      } else {
        // Standard query string search
        query.addMatchQueryStringRule(userQuery);
      }
    }

    // Term filtering
    let termQuery = { ...body };
    for (const term in termQuery) {
      if (nonKeyableTerms.indexOf(term) > -1) {
        delete termQuery[term];
      }
    }

    logger.debug("Term query filtering:", termQuery);
    query.addFilterTermsRule(termQuery, true);

    // Send the query to the OpenSearch cluster
    let response = await query.search();
    logger.debug("Request:", query.request); // Log the request (available after sending)
    logger.debug("Response:", response); // Log the response

    // Send a success response
    return sendResponse(200, response?.body?.hits, "Success", null, context);
  } catch (err) {
    logger.error(JSON.stringify(err)); // Log the error

    // Send an error response
    return sendResponse(
      err?.code || 400,
      [],
      err?.msg || "Error",
      err?.error || err,
      context
    );
  }
};
