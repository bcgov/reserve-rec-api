// pull index mapping from the cdk definition
const indexMappingOptions = require('../../../../lib/opensearch-stack/init-opensearch/indexMappingOptions');
const axios = require('axios');
const aws4 = require('aws4');
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

const OPENSEARCH_REFERENCE_DATA_INDEX_NAME = 'reference-data-index';
const OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME = 'transactional-data-index';
const OPENSEARCH_DOMAIN_ENDPOINT = 'http://opensearch.proxmox.ds:9200';
const OPENSEARCH_DASHBOARDS_ENDPOINT = 'http://opensearch.proxmox.ds:5601';

const TIME_FIELD = process.env.TIME_FIELD || 'lastUpdated';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

const indexKey = process.argv[2];
const deleteOldIndex = true;

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

const client = new Client({
  ...AwsSigv4Signer({
    region: 'ca-central-1',
    service: 'es',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    }
  }),
  node: OPENSEARCH_DOMAIN_ENDPOINT // OpenSearch domain URL
});

async function run() {
  console.log('Create OpenSearch Indexes');
  try {
    const indexList = await listIndices();
    console.log('Available Indexes:', indexList?.body.map(i => i?.index));

    const indexConfig = indexes.find(i => i.key === indexKey);

    if (!indexKey || !indexConfig) {
      throw new Error(`Invalid indexKey '${indexKey}' provided. Valid values are: ` + indexes.map(i => i.key).join(', '));
    }

    let exists = await checkIndex(indexConfig.name);

    // Delete the old index if it exists and it is required
    if (exists?.statusCode === 200 && deleteOldIndex) {
      console.log(`Deleting old index '${indexConfig.name}'`);
      await deleteIndex(indexConfig.name);
      console.log(`Deleted old index: ${indexConfig.name}`);
    }

    // Create new index if it doesn't exist
    exists = await checkIndex(indexConfig.name);
    if (exists?.statusCode === 404) {
      // Index doesn't exist
      console.log(`Creating index '${indexConfig.name}'`);
      const createdIndex = await createIndex(indexConfig.name, indexConfig.mapping);
      console.log(`Created index: ${indexConfig.name}`, createdIndex);
    } else {
      console.log(`Index '${indexConfig.name}' already exists. No action taken.`);
    }

    // Create index pattern in OpenSearch Dashboards (if applicable)
    // const indexPattern = {
    //   attributes: {
    //     title: `${indexConfig.name}*`,
    //     timeFieldName: TIME_FIELD,
    //   }
    // };

    // const res = await signedRequest('POST', `/_dashboards/api/index_patterns/index_pattern`, indexPattern);
    // console.log(`Created index pattern for ${indexConfig.name}`);

    console.log('success');
    return res?.data

  } catch (err) {
    console.log(err.message, err.response?.data || err);
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

  console.log('url.toString():', url.toString());

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

async function createIndex(indexName, mappings = {}) {
  try {
    await client.indices.create({
      index: indexName,
      body: {
        mappings: mappings
      }
    });

  } catch (error) {
    console.log(`Error creating index: ${error}`);
    throw error;
  }
}

async function checkIndex(indexName) {
  // Check if the index exists
  return await client.indices.exists({ index: indexName });
}

async function listIndices() {
  return await client.cat.indices({ format: 'json' });
}

async function deleteIndex(indexName) {
  return await client.indices.delete({ index: indexName });
}

run();

