#!/usr/bin/env node

const { CognitoIdentityProviderClient, ListUsersCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, DeleteCommand, paginateQuery } = require('@aws-sdk/lib-dynamodb');

const DEFAULT_REGION = 'ca-central-1';
const DEFAULT_TABLE_NAME = 'ReserveRecApi-[ENV]-TransactionalDataStack-TransactionalDataTable';
const DEFAULT_USER_POOL_ID = 'ca-central-1_123456789';

function parseArgs(args) {
  const options = {
    delete: false,
    yes: false,
    tableName: process.env.TRANSACTIONAL_DATA_TABLE_NAME || process.env.TABLE_NAME || DEFAULT_TABLE_NAME,
    userPoolId: process.env.USER_POOL_ID || DEFAULT_USER_POOL_ID,
    region: process.env.AWS_REGION || DEFAULT_REGION,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--delete') options.delete = true;
    else if (argument === '--yes') options.yes = true;
    else if (argument === '--table-name') options.tableName = args[++index];
    else if (argument === '--user-pool-id') options.userPoolId = args[++index];
    else if (argument === '--region') options.region = args[++index];
    else if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }

  if (!options.userPoolId) throw new Error('Missing Cognito pool ID. Set USER_POOL_ID or pass --user-pool-id <id>.');
  if (!options.tableName) throw new Error('Missing DynamoDB table name. Set TABLE_NAME or pass --table-name <name>.');
  if (options.yes && !options.delete) throw new Error('--yes requires --delete.');
  return options;
}

function printUsage() {
  console.log(`Usage: node src/scripts/tools/cleanup-orphaned-users.js [options]

Scans user records and reports records whose sub is absent from the Cognito pool.
The default is a dry run. Add --delete --yes to remove orphaned records.

Options:
  --user-pool-id <id>  Cognito pool to check (or USER_POOL_ID)
  --table-name <name>  DynamoDB table (or TRANSACTIONAL_DATA_TABLE_NAME)
  --region <region>    AWS region (default: ${DEFAULT_REGION})
  --delete             Delete orphaned records
  --yes                Required with --delete
  --help               Show this help
`);
}

// Query the database for all items with pk: 'user' and schema: 'user'
async function queryUserRecords(docClient, tableName) {
  const records = [];

  const paginator = paginateQuery(
    { client: docClient },
    {
      TableName: tableName,
      KeyConditionExpression: 'pk = :pk',
      FilterExpression: '#schema = :schema',
      ExpressionAttributeNames: { '#schema': 'schema' },
      ExpressionAttributeValues: { 
        ':pk': 'user', 
        ':schema': 'user' 
      },
    }
  );

  for await (const page of paginator) {
    records.push(...(page.Items || []));
  }

  return records;
}

// Pass in the user sub and check that this user's sub exists in the user pool
async function userExists(cognitoClient, userPoolId, sub) {
  let paginationToken;
  do {
    const response = await cognitoClient.send(new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `sub = "${sub.replaceAll('"', '\\"')}"`,
      PaginationToken: paginationToken,
      Limit: 60,
    }));
    if ((response.Users || []).some(user => user.Attributes?.some(attribute => attribute.Name === 'sub' && attribute.Value === sub))) return true;
    paginationToken = response.PaginationToken;
  } while (paginationToken);
  return false;
}

// Delete the user item from dynamo
async function deleteUserRecord(docClient, tableName, record) {
  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { pk: record.pk, sk: record.sk },
    ConditionExpression: 'pk = :pk AND sk = :sk AND #schema = :schema',
    ExpressionAttributeNames: { '#schema': 'schema' },
    ExpressionAttributeValues: { ':pk': 'user', ':sk': record.sk, ':schema': 'user' },
  }));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dynamoClient = new DynamoDBClient({ region: options.region });
  const docClient = DynamoDBDocumentClient.from(dynamoClient);
  const cognitoClient = new CognitoIdentityProviderClient({ region: options.region });
  console.log(`Table: ${options.tableName}`);
  console.log(`User pool: ${options.userPoolId}`);
  console.log(`Mode: ${options.delete ? 'DELETE' : 'DRY RUN'}`);

  const records = await queryUserRecords(docClient, options.tableName);
  const orphaned = [];
  for (const record of records) {
    if (!record.sk || !(await userExists(cognitoClient, options.userPoolId, record.sk))) {
      orphaned.push(record);
      console.log(`Orphaned: pk=${record.pk}, sk=${record.sk}`);
    }
  }
  console.log(`Scanned ${records.length} user records; found ${orphaned.length} orphaned records.`);

  if (options.delete) {
    for (const record of orphaned) await deleteUserRecord(docClient, options.tableName, record);
    console.log(`Deleted ${orphaned.length} orphaned records.`);
  } else if (orphaned.length > 0) {
    console.log('No records were deleted. Re-run with --delete --yes to delete these records.');
  }
}

main().catch(error => {
  console.error(`Cleanup failed: ${error.message}`);
  process.exitCode = 1;
});
