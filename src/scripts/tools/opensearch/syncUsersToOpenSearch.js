// Sync users from DynamoDB to OpenSearch for local development
// This script is needed because SAM local doesn't trigger DynamoDB streams automatically

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');
const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

// Configuration
const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_DOMAIN_ENDPOINT || 'http://10.192.70.15:9200';
const TABLE_NAME = process.env.TRANSACTIONAL_DATA_TABLE_NAME || 'ReserveRecApi-Local-TransactionalDataTable';
const INDEX_NAME = 'transactional-data-index';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';

// DynamoDB Client
const dynamoClient = new DynamoDBClient({
  region: AWS_REGION,
  endpoint: DYNAMODB_ENDPOINT,
});

// OpenSearch Client
const osClient = new Client({
  ...AwsSigv4Signer({
    region: AWS_REGION,
    service: 'es',
    getCredentials: () => {
      const credentialsProvider = defaultProvider();
      return credentialsProvider();
    }
  }),
  node: OPENSEARCH_ENDPOINT
});

async function syncUsersToOpenSearch() {
  console.log('=== Syncing Users from DynamoDB to OpenSearch ===');
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Index: ${INDEX_NAME}`);
  console.log('');

  try {
    // Step 1: Scan DynamoDB for all users
    console.log('Step 1: Scanning DynamoDB for users with schema="user"...');
    const users = [];
    let lastEvaluatedKey = undefined;

    do {
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: '#schema = :schema',
        ExpressionAttributeNames: {
          '#schema': 'schema'
        },
        ExpressionAttributeValues: {
          ':schema': { S: 'user' }
        },
        ExclusiveStartKey: lastEvaluatedKey
      });

      const response = await dynamoClient.send(scanCommand);
      
      if (response.Items) {
        const unmarshalled = response.Items.map(item => unmarshall(item));
        users.push(...unmarshalled);
        console.log(`  Found ${response.Items.length} users in this batch`);
      }

      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    console.log(`\nTotal users found: ${users.length}`);

    if (users.length === 0) {
      console.log('No users to sync. Exiting.');
      return;
    }

    // Step 2: Prepare bulk operations for OpenSearch
    console.log('\nStep 2: Preparing bulk index operations...');
    const bulkBody = [];

    for (const user of users) {
      // Create OpenSearch document ID from DynamoDB keys
      const docId = `${user.pk}#${user.sk}`;
      
      // Index operation
      bulkBody.push({
        index: {
          _index: INDEX_NAME,
          _id: docId
        }
      });

      // Document data
      bulkBody.push(user);
    }

    // Step 3: Bulk index to OpenSearch
    console.log('Step 3: Bulk indexing to OpenSearch...');
    const bulkResponse = await osClient.bulk({
      body: bulkBody,
      refresh: true
    });

    if (bulkResponse.errors) {
      console.error('Some documents failed to index:');
      bulkResponse.items.forEach((item, i) => {
        if (item.index?.error) {
          console.error(`  Document ${i}: ${item.index.error.reason}`);
        }
      });
    } else {
      console.log(`✓ Successfully indexed ${users.length} users to OpenSearch`);
    }

    // Step 4: Verify
    console.log('\nStep 4: Verifying indexed users...');
    const countResponse = await osClient.count({
      index: INDEX_NAME,
      body: {
        query: {
          term: { schema: 'user' }
        }
      }
    });

    console.log(`✓ Total users in OpenSearch: ${countResponse.body.count}`);
    console.log('\n=== Sync Complete ===');

  } catch (error) {
    console.error('Error syncing users:', error.message);
    if (error.meta?.body) {
      console.error('OpenSearch error:', JSON.stringify(error.meta.body, null, 2));
    }
    throw error;
  }
}

// Run the sync
syncUsersToOpenSearch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
