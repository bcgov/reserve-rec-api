const AWS = require("aws-sdk");
const axios = require('axios');
const data = require('./dump.json');
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node'); // V3 SDK.
const { updateConsoleProgress, finishConsoleUpdates, errorConsoleUpdates } = require('./progressIndicator');
const OPENSEARCH_DOMAIN_ENDPOINT = process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'http://opensearch.dynamodb.ds:9200';
const OPENSEARCH_MAIN_INDEX = process.env.OPENSEARCH_MAIN_INDEX || 'main-index';
// Note: it is not clear what the bulk limit is for OpenSearch - based on performance.
// Change the value for BULK_OPERATION_LIMIT as necessary.
// https://repost.aws/knowledge-center/opensearch-indexing-performance
const BULK_OPERATION_LIMIT = 100;

const DELETE_OLD_INDEX = process.env.DELETE_OLD_INDEX || false;

let osClient = new Client({
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

/**
 * Creates an OpenSearch index if it doesn't already exist.
 */
async function establishIndex() {
  if (DELETE_OLD_INDEX) {
    console.log(`Deleting index '${OPENSEARCH_MAIN_INDEX}'`);
    await osClient.indices.delete({ index: OPENSEARCH_MAIN_INDEX });
  }

  // check if index exists
  const exists = await osClient.indices.exists({ index: OPENSEARCH_MAIN_INDEX });
  if (exists.statusCode === 404) {
    // Index doesnt exist
    console.log(`Creating index '${OPENSEARCH_MAIN_INDEX}'`);
    await osClient.indices.create({ index: OPENSEARCH_MAIN_INDEX });
    await createMappings();
  }
}

async function createMappings() {
  // create mappings before importing data
  // create PUT URL
  let url = `${OPENSEARCH_DOMAIN_ENDPOINT}/${OPENSEARCH_MAIN_INDEX}/_mapping`;
  let mappings = {
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

  let auth =
  {
    ...AwsSigv4Signer({
      region: 'ca-central-1',
      service: 'es',
      getCredentials: () => {
        const credentialsProvider = defaultProvider();
        return credentialsProvider();
      }
    }),
  };

  try {
    let res = await axios.put(url, mappings, {
      headers: {
        Authorization: auth
      }
    });
    if (res.status !== 200) {
      throw `Error creating mappings: ${res.statusText}`;
    }
  } catch (err) {
    throw `Error creating mappings: ${err}`;
  }

}

async function restoreOpenSearch() {
  console.log("Running OpenSearch importer...");
  let startTime = new Date().getTime();
  try {
    console.log('data:', data);
    console.log('data.Items.length:', data.Items.length);
    for (let i = 0; i < data.Items.length; i += BULK_OPERATION_LIMIT) {
      updateConsoleProgress(startTime, "Importing", 1, i + 1, data.Items.length);
      let dataChunk = data.Items.slice(i, i + BULK_OPERATION_LIMIT);
      let bulkIndexChunk = [];
      for (const item of dataChunk) {
        let doc = AWS.DynamoDB.Converter.unmarshall(item);
        bulkIndexChunk.push({
          update: {
            _index: OPENSEARCH_MAIN_INDEX,
            _id: `${item.pk.S}#${item.sk.S}`,
          }
        });
        bulkIndexChunk.push({
          doc: doc,
          doc_as_upsert: true
        });
      }
      if (bulkIndexChunk.length > 0) {
        let res = await osClient.bulk({
          body: bulkIndexChunk
        });
        if (res.body.errors) {
          throw JSON.stringify(res.body.items, null, 2);
        }
      }
    }
    updateConsoleProgress(startTime, "Importing", 1, data.Items.length, data.Items.length);
    finishConsoleUpdates();
    await osClient.indices.refresh({ index: OPENSEARCH_MAIN_INDEX });
  } catch (err) {
    console.log("Error populating OpenSearch.");
    throw err;
  }
}

async function run() {
  try {
    // checks to see if OS is running
    await osClient.info();
    await establishIndex();
    await restoreOpenSearch();
  } catch (err) {
    errorConsoleUpdates(err);
  }
}

run();
