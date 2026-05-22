/**
 * DynamoDB Table Wipe Script
 *
 * Scans the table and deletes collection-related items by pk pattern.
 * Use this to clear the table before re-seeding.
 *
 * Usage:
 *   TABLE_NAME=ReserveRecApi-Local-ReferenceDataTable \
 *   DYNAMODB_ENDPOINT_URL=http://localhost:8000 \
 *   node dynamoWipe.js
 */

const AWS = require('aws-sdk');
const readline = require('readline');
const { updateConsoleProgress, finishConsoleUpdates, errorConsoleUpdates } = require('./progressIndicator');

const TABLE_NAME = process.env.TABLE_NAME || 'ReserveRecApi-Local-ReferenceDataStack-ReferenceDataTable';
const MAX_BATCH_SIZE = 25;

// Exact pk values to delete (query)
const EXACT_PKS = ['collection', 'protectedArea'];

// pk prefixes to delete (scan with begins_with)
const PK_PREFIXES = [
  'geozone::',
  'facility::',
  'activity::',
  'product::',
  'productDate::',
  'inventoryPool::',
  'rel::',
];

const options = {
  region: process.env.AWS_REGION || 'local',
  endpoint: process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000/'
};

console.log('Using DynamoDB config:', options);
console.log('Table:', TABLE_NAME);

const dynamodb = new AWS.DynamoDB.DocumentClient(options);

async function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

/**
 * Scans for all items matching the configured pk exact values and prefixes.
 * Builds a single FilterExpression with OR conditions across all patterns.
 */
async function scanTargeted() {
  const items = [];
  let lastKey = undefined;

  // Build FilterExpression: pk = :exact0 OR begins_with(pk, :prefix0) OR ...
  const exactClauses   = EXACT_PKS.map((_, i) => `pk = :exact${i}`);
  const prefixClauses  = PK_PREFIXES.map((_, i) => `begins_with(pk, :prefix${i})`);
  const filterExpr     = [...exactClauses, ...prefixClauses].join(' OR ');

  const exprValues = {};
  EXACT_PKS.forEach((val, i)    => { exprValues[`:exact${i}`]  = val; });
  PK_PREFIXES.forEach((val, i)  => { exprValues[`:prefix${i}`] = val; });

  do {
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: filterExpr,
      ExpressionAttributeValues: exprValues,
      ExclusiveStartKey: lastKey,
    };
    const result = await dynamodb.scan(params).promise();
    items.push(...result.Items);
    lastKey = result.LastEvaluatedKey;
    process.stdout.write(`  Scanning... ${items.length} items found\r`);
  } while (lastKey);

  process.stdout.write('\n');
  return items;
}

async function deleteAll(items) {
  const startTime = new Date().getTime();

  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    updateConsoleProgress(startTime, 'Deleting', 1, i + 1, items.length);
    const chunk = items.slice(i, i + MAX_BATCH_SIZE);

    // DocumentClient requires only the key attributes — extract pk and sk
    const deleteRequests = chunk.map(item => ({
      DeleteRequest: {
        Key: { pk: item.pk, sk: item.sk },
      },
    }));

    await dynamodb.batchWrite({
      RequestItems: { [TABLE_NAME]: deleteRequests },
    }).promise();
  }

  updateConsoleProgress(startTime, 'Deleting', 1, items.length, items.length);
  finishConsoleUpdates();
}

async function run() {
  try {
    console.log('\nScanning table...');
    const items = await scanTargeted();

    if (items.length === 0) {
      console.log('Table is already empty.');
      return;
    }

    console.log(`Found ${items.length} items.`);

    const answer = await confirm(`\nAre you sure you want to delete ALL ${items.length} items from "${TABLE_NAME}"? (yes/no): `);
    if (answer !== 'yes') {
      console.log('Aborted.');
      return;
    }

    console.log('');
    await deleteAll(items);
    console.log(`\nDone. ${items.length} items deleted from ${TABLE_NAME}.`);
  } catch (error) {
    errorConsoleUpdates(error);
    console.error('\nWipe failed:', error.message);
    process.exit(1);
  }
}

run();
