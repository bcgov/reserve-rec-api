
const { defaultProvider } = require('@aws-sdk/credential-provider-node'); // V3 SDK.
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { logger } = require('/opt/base');
const axios = require('axios');

// Import necessary libraries and modules
const OPENSEARCH_DOMAIN_URL = process.env.OPENSEARCH_DOMAIN_URL || 'http://localhost:9200';
const OPENSEARCH_MAIN_INDEX = process.env.OPENSEARCH_MAIN_INDEX || 'main-index';
const OPENSEARCH_AUDIT_INDEX = process.env.OPENSEARCH_MAIN_INDEX || 'audit-index';
const OPENSEARCH_DEFAULT_SORT_ORDER = 'asc'; // asc or desc
const DEFAULT_RESULT_SIZE = 10;
const MAX_RESULT_SIZE = 100;
const OPENSEARCH_DOMAIN_NAME = process.env.OPENSEARCH_DOMAIN_NAME;

// Maximum number of transactions in a single batch - the real limit is roughly 6.3MB
const TRANSACTION_MAX_SIZE = 100;

// Query parameters that should not be used as keyable search terms
const nonKeyableTerms = [
  'text',
  'startFrom',
  'limit',
  'sortField',
  'sortOrder',
];

let client = new Client({
  ...AwsSigv4Signer({
    region: 'ca-central-1',
    service: 'es',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    }
  }),
  node: OPENSEARCH_DOMAIN_URL // OpenSearch domain URL
});

// For offline development
if (process.env.IS_OFFLINE === 'true') {
  client = new Client({
    node: OPENSEARCH_DOMAIN_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

/**
 * A class representing an OpenSearch query builder.
 *
 * @class
 */
class OSQuery {
  /**
   * Creates an instance of the OpenSearch query builder.
   *
   * @param {string} index - The index to search.
   * @param {Object} [options={}] - The options for the search query.
   * @param {number} [options.size] - The maximum number of results to return.
   * @param {number} [options.from=0] - The starting index for the results.
   * @param {string} [options.sortField] - The field to sort the results by.
   * @param {'asc' | 'desc'} [options.sortOrder='asc'] - The sorting method to use when sorting results.
   * @param {string} [options.pipeline] - The pipeline to use for the search.
   */
  constructor(index, options = {}) {
    /**
     * The query object representing the OpenSearch query.
     * @type {Object}
     */
    this.query = {};
    /**
     * The index to search.
     * @type {string}
     */
    this.index = index || OPENSEARCH_MAIN_INDEX;
    /**
     * The maximum number of results to return.
     * @type {number}
     */
    this.size = setSearchLimit(options?.size);
    /**
     * The starting index for the results.
     * @type {number}
     * @default DEFAULT_RESULT_SIZE
     */
    this.from = options?.from || 0;
    /**
     * The field to sort the results by.
     * @type {string}
     */
    this.sortField = options?.sortField || null;
    /**
     * The sorting method to use when sorting results.
     * @type {string}
     * @default 'asc'
     * @enum {'asc' | 'desc'}
     */
    this.sortOrder = options?.sortOrder || OPENSEARCH_DEFAULT_SORT_ORDER;
    /**
     * The sort object for sorting the results.
     * @type {Object}
     */
    this.sort = null;
    /**
     * The pipeline to use for the search.
     * @type {string}
     */
    this.pipeline = options?.pipeline || null;
    this.request = null;
    this.initSortQuery();
  }

  /**
   * Performs an asynchronous search using the configured query parameters.
   *
   * @async
   * @returns {Promise<Object>} A Promise that resolves to the search result.
   */
  async search() {
    // Match at least 1 OR condition
    if (this.query?.bool?.should) {
      this.query.bool['minimum_should_match'] = 1;
    }
    this.request = {
      index: this.index,
      size: this.size,
      from: this.from,
    };
    let body = {};
    // add query to body if provided
    if (Object.keys(this.query).length > 0) {
      body['query'] = this.query;
    }
    // Add sort to body if provided
    if (this.sort) {
      body['sort'] = this.sort;
    }
    // Add pipeline to body if provided
    if (this.pipeline) {
      body['search_pipeline'] = this.pipeline;
    }
    if (Object.keys(body).length > 0) {
      this.request.body = body;
    }
    return await client.search(this.request);
  }

  initSortQuery() {
    if (this.sortField) {
      this.addSortRule(this.sortField, this.sortOrder);
    } else {
      this.sort = null;
    }
  }

  /**
   * Adds a match query string rule to the OpenSearch query.
   *
   * @param {string} string - The string to match in the query.
   */
  addMatchQueryStringRule(string) {
    setNestedValue(
      this.query,
      ['bool', 'must'],
      {
        query_string: {
          query: escapeOpenSearchQuery(string)
        }
      }
    );
  }

  /**
   * Adds must match terms rule to the OpenSearch query (logical `AND`).
   *
   * @param {Array} terms - An array of terms to match in the query.
   * @param {Boolean} exactMatch - If true, term must match exactly to return a hit. Default false.
   */
  addMustMatchTermsRule(terms, exactMatch = false) {
    addTermsRule(this.query, terms, 'must', exactMatch);
  }

  /**
   * Adds a filter terms rule to the OpenSearch query (logical `AND` applied before querying to reduce query set).
   *
   * @param {Array<string>} terms - The terms to be added as filter rules.
   */
  addFilterTermsRule(terms) {
    addTermsRule(this.query, terms, 'filter', true);
  }

  /**
   * Adds must not match terms rule to the OpenSearch query (logical `NOT`).
   *
   * @param {Array} terms - An array of terms to exclude from the query.
   * @param {Boolean} exactMatch - If true, term must match exactly to ignore a hit. Default false.
   */
  addMustNotMatchTermsRule(terms, exactMatch = false) {
    addTermsRule(this.query, terms, 'must_not', exactMatch);
  }

  /**
 * Adds should match terms rule to the OpenSearch query (logical `OR`).
 *
 * @param {Array} terms - An array of terms to exclude from the query.
 * @param {Boolean} exactMatch - If true, term must match exactly to ignore a hit. Default false.
 */
  addShouldMatchTermsRule(terms, exactMatch = false) {
    addTermsRule(this.query, terms, 'should', exactMatch);
  }

  /**
   * Adds a query rule to filter results by a list of IDs.
   *
   * @param {Array<string>} ids - An array of IDs to filter the query results.
   */
  addIDsQueryRule(ids) {
    setNestedValue(
      this.query,
      ['ids'],
      {
        values: ids
      }
    );
  }

  /**
   * Adds sort rule to the OpenSearch query. Only single field sorting is currently supported
   *
   * @param {String} field - The field to order by
   * @param {String} order - Sort order ('asc' or 'desc').
   */
  addSortRule(field, order = OPENSEARCH_DEFAULT_SORT_ORDER) {
    this.sort = [{
      [field]: {
        order: order
      }
    }];
  }

  addRangeQueryRule(field, rangeStart, rangeEnd, includeStart = true, includeEnd = true) {
    let rangeStartOperator = includeStart ? 'gte' : 'gt';
    let rangeEndOperator = includeEnd ? 'lte' : 'lt';

    setNestedValue(
      this.query,
      ['bool', 'filter'],
      {
        range: {
          [field]: {
            [rangeStartOperator]: rangeStart,
            [rangeEndOperator]: rangeEnd
          }
        }
      }
    );
  }

  updateSearchPipeline(pipeline) {
    this.pipeline = pipeline;
  }
}

/**
 * Adds terms rule to the OpenSearch query.
 *
 * @param {Object} query - The OpenSearch query object to which the terms rule will be added.
 * @param {Object} terms - An object representing the terms to be matched in the query.
 * @param {boolean} [ignore=false] - If true, adds terms as "must_not" in the query; otherwise, adds as "must".
 * @param {boolean} [exactMatch=true] - If true, uses "terms" in the match; otherwise, uses "match".
 */
function addTermsRule(query, terms, clause = 'filter', exactMatch = true) {
  let match = exactMatch ? 'terms' : 'match';
  for (const term of Object.keys(terms)) {
    let value = terms[term];
    // determine value type
    switch (typeof terms[term]) {
      case 'boolean':
        match = 'terms';
        value = [value];
        break;
      default:
        value = value.toLowerCase();
        if (exactMatch) {
          value = value.split(',');
        }
        break;
    }
    setNestedValue(
      query,
      ['bool', clause],
      {
        [match]: {
          [term]: value
        }
      }
    );
  }
}

/**
 * Sets a nested value in an object based on an array of keys.
 *
 * @param {Object} root - The root object in which the nested value will be set.
 * @param {Array} keys - An array of keys representing the path to the nested value.
 * @param {any} value - The value to be set at the nested path.
 * @param {boolean} [append=true] - If true, appends the value to an existing array; otherwise, replaces the value.
 */
function setNestedValue(root, keys, value, append = true) {
  if (keys.length === 1) {
    if (append) {
      if (root?.[keys[0]]?.length) {
        root[keys[0]].push(value);
      } else {
        root[keys[0]] = [value];
      }
    } else {
      root[keys[0]] = value;
    }
  } else {
    root[keys[0]] = root[keys[0]] || {};
    setNestedValue(root[keys[0]], keys.slice(1), value);
  }
}

/**
 * Escapes special characters in an OpenSearch query string.
 *
 * @param {string} input - The input string to be escaped.
 * @returns {string} The escaped OpenSearch query string.
 */
function escapeOpenSearchQuery(input) {
  // Define a regular expression pattern for reserved characters
  const pattern = /([-&|!(){}[\]^"~*?:\/+])/g;
  // Use the replace method with a callback function to handle replacements
  const escapedQuery = input.replace(pattern, (match, p1) => `\\${p1}`);
  return escapedQuery;
}

/**
 * Sets the search limit, ensuring it falls within the specified bounds.
 *
 * @param {number} [limit=DEFAULT_RESULT_SIZE] - The requested limit for search results.
 * @returns {number} The adjusted search limit within the allowed bounds.
 */
function setSearchLimit(limit = DEFAULT_RESULT_SIZE) {
  let requestedLimit = limit;
  if (requestedLimit < 1) {
    requestedLimit = 1;
  }
  if (requestedLimit > MAX_RESULT_SIZE) {
    requestedLimit = MAX_RESULT_SIZE;
  }
  return requestedLimit;
}

async function checkIndexExists(indexName) {
  return await client.indices.exists({ index: indexName });
}

function buildIdFromPkSk(pk, sk) {
  return `${pk}#${sk}`;
}

async function listIndices() {
  return await client.cat.indices({ format: 'json' });
}

async function checkIndex(indexName) {
  return await client.indices.exists({ index: indexName });
}

// Function to chunk the data into smaller arrays
function chunkArray(array, chunkSize) {
  const result = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    result.push(array.slice(i, i + chunkSize));
  }
  return result;
}

async function createIndex(indexName, mappings = {}) {
  try {

    const url = `${OPENSEARCH_DOMAIN_URL}/${indexName}/_mapping`;

    const indexRef = await client.indices.create({
      index: indexName,
    });

    logger.debug('Index created', indexRef);

    let auth = {
      ...AwsSigv4Signer({
        region: 'ca-central-1',
        service: 'es',
        getCredentials: () => {
          const credentialsProvider = defaultProvider();
          return credentialsProvider();
        }
      })
    };

    logger.debug('Authentication:', auth);

    try {
      let res = await axios.put(url, mappings, {
        headers: {
          Authorization: auth
        }
      });
      if (res.status !== 200) {
        throw `Error creating mappings: ${res.statusText}`;
      }
      return res;
    } catch (err) {
      throw `Error creating mappings: ${err}`;
    }
  } catch (error) {
    logger.error('Error creating index:', error);
    throw error;
  }
}

async function deleteIndex(indexName) {
  return await client.indices.delete({ index: indexName });
}

async function bulkWriteDocuments(items, indexName = OPENSEARCH_MAIN_INDEX, action = 'update') {
  // actions: [create, update, delete, index]

  const dataChunks = chunkArray(items, TRANSACTION_MAX_SIZE);

  logger.info('indexName:', indexName);
  logger.info('Documents:', items.length);
  logger.info('Transactions:', dataChunks.length);

  try {
    for (let i = 0; i < dataChunks.length; i++) {
      const chunk = dataChunks[i];

      await client.helpers.bulk({
        datasource: chunk,
        refreshOnCompletion: true, // Refresh the index after the operation
        onDocument(doc) {
          if (!doc.id) {
            throw new Error('Document does not have an ID: ' + JSON.stringify(doc));
          }
          let newDoc = [
            {
              [action]: {
                _id: doc.id,
                _index: indexName
              }
            },
          ];
          // update actions must be a tuple with the document and the upsert flag
          if (action === 'update') {
            newDoc.push({
              doc_as_upsert: true // Create if it doesn't exist
            });
          }
          return newDoc;
        }
      });

      logger.info(`BatchWriteItem response for chunk ${i}: complete`);
    }
  } catch (error) {
    logger.error('Error updating documents:', error);
    throw error;
  }
}

module.exports = {
  OPENSEARCH_AUDIT_INDEX,
  OPENSEARCH_DOMAIN_NAME,
  OPENSEARCH_DOMAIN_URL,
  OPENSEARCH_MAIN_INDEX,
  OSQuery,
  buildIdFromPkSk,
  bulkWriteDocuments,
  checkIndexExists,
  client,
  checkIndex,
  createIndex,
  deleteIndex,
  listIndices,
  nonKeyableTerms
};