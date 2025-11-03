const { sendResponse, logger } = require('/opt/base');
const { checkIndex, createIndex, deleteIndex, listIndices } = require('/opt/opensearch');
const indexMappingOptions = require('./indexMappingOptions');
const axios = require('axios');
const aws4 = require('aws4');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

const OPENSEARCH_REFERENCE_DATA_INDEX_NAME = process.env.OPENSEARCH_REFERENCE_DATA_INDEX_NAME || 'reference-data-index';
const OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME = process.env.OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME || 'transactional-data-index';
const OPENSEARCH_DOMAIN_ENDPOINT = process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'http://localhost:9200';

const TIME_FIELD = process.env.TIME_FIELD || 'lastUpdated';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const indexes = [
  {
    key: 'referenceData',
    name: OPENSEARCH_REFERENCE_DATA_INDEX_NAME,
    mapping: indexMappingOptions.refDataIndexMappingOptions,
  },
  {
    key: 'transactionalData',
    name: OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME,
    mapping: indexMappingOptions.transDataIndexMappingOptions,
  }
];

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
      logger.info(`Created index: ${indexConfig.name}`, createdIndex);
    } else {
      logger.info(`Index '${indexConfig.name}' already exists. No action taken.`);
    }

    // Create index pattern in OpenSearch Dashboards (if applicable)
    const indexPattern = {
      attributes: {
        title: `${indexConfig.name}*`,
        timeFieldName: TIME_FIELD,
      }
    };

    const res = await signedRequest('POST', `/_dashboards/api/saved_objects/index-pattern`, indexPattern);
    logger.info(`Created index pattern for ${indexConfig.name}`);


    return sendResponse(200, res?.data, `Created new index: ${indexConfig.name}`, null, context);

  } catch (err) {
    logger.error(err.message, err.response?.data || err);
    return sendResponse(400, [], 'Error', { message: err.message, details: err.response?.data }, context);
  }
};

// Helper to sign requests with SigV4
async function signedRequest(method, path, body) {
  const url = new URL(path, OPENSEARCH_DOMAIN_ENDPOINT);
  const credentials = await defaultProvider()();

  const opts = {
    host: url.hostname,
    path: url.pathname,
    method,
    service: "es",
    region: AWS_REGION,
    headers: {
      "Content-Type": "application/json",
      "osd-xsrf": "true"
    },
    body: body ? JSON.stringify(body) : undefined
  };

  aws4.sign(opts, credentials);

  const res = await axios({
    url: url.toString(),
    method,
    headers: opts.headers,
    data: body,
  });

  console.log('after');

  return {
    status: res.status,
    data: res.data
  };

}

