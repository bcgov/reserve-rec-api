#!/usr/bin/env node

/**
 * Migration script to standardize collection ID field names
 * Changes gzCollectionId, acCollectionId, fcCollectionId to collectionId
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const TABLE_NAME = process.env.TABLE_NAME || 'reserve-rec-main';

const options = {
  region: AWS_REGION,
};

if (process.env?.IS_OFFLINE === 'true') {
  options.endpoint = DYNAMODB_ENDPOINT_URL;
}

const client = new DynamoDBClient(options);
const docClient = DynamoDBDocumentClient.from(client);

const FIELD_MAPPINGS = {
  gzCollectionId: "collectionId",
  acCollectionId: "collectionId",
  fcCollectionId: "collectionId",
};

/**
 * Scan and migrate items in batches
 */
async function migrateCollectionIds(dryRun = true) {
  console.log(`Starting migration - Dry Run: ${dryRun}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Field mappings:`, FIELD_MAPPINGS);
  
  let totalScanned = 0;
  let totalMigrated = 0;
  let lastEvaluatedKey = null;
  
  do {
    const scanParams = {
      TableName: TABLE_NAME,
      FilterExpression: 'attribute_exists(gzCollectionId) OR attribute_exists(acCollectionId) OR attribute_exists(fcCollectionId)',
      Limit: 100 // Process in batches
    };
    
    // Only add ExclusiveStartKey if we have a valid lastEvaluatedKey
    if (lastEvaluatedKey) {
      scanParams.ExclusiveStartKey = lastEvaluatedKey;
    }
    
    try {
      const result = await docClient.send(new ScanCommand(scanParams));
      
      totalScanned += result.Items.length;
      console.log(`Scanned ${result.Items.length} items (Total: ${totalScanned})`);
      
      // Process each item
      for (const item of result.Items) {
        const migrated = await migrateItem(item, dryRun);
        if (migrated) totalMigrated++;
      }
      
      lastEvaluatedKey = result.LastEvaluatedKey;
      
      // Add a small delay to avoid throttling
      if (lastEvaluatedKey) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
    } catch (error) {
      console.error('Error during scan:', error);
      throw error;
    }
    
  } while (lastEvaluatedKey);
  
  console.log(`\nMigration complete:`);
  console.log(`- Total items scanned: ${totalScanned}`);
  console.log(`- Total items migrated: ${totalMigrated}`);
  
  return { totalScanned, totalMigrated };
}

/**
 * Migrate a single item
 */
async function migrateItem(item, dryRun = true) {
  let needsMigration = false;
  let updateExpression = 'SET ';
  let attributeValues = {};
  let removeExpression = 'REMOVE ';
  let hasRemoves = false;
  
  // Check which fields need migration
  for (const [oldField, newField] of Object.entries(FIELD_MAPPINGS)) {
    if (item.hasOwnProperty(oldField)) {
      needsMigration = true;
      
      // Set the new field
      updateExpression += `${newField} = :${newField}, `;
      attributeValues[`:${newField}`] = item[oldField];
      
      // Remove the old field
      removeExpression += `${oldField}, `;
      hasRemoves = true;
      
      console.log(`  - Found ${oldField}: ${item[oldField]} -> ${newField}`);
    }
  }
  
  if (!needsMigration) {
    return false;
  }
  
  // Clean up expressions
  updateExpression = updateExpression.slice(0, -2); // Remove trailing ', '
  if (hasRemoves) {
    removeExpression = removeExpression.slice(0, -2); // Remove trailing ', '
    updateExpression += ' ' + removeExpression;
  }
  
  console.log(`Migrating item: pk=${item.pk}, sk=${item.sk}`);
  console.log(`  Update expression: ${updateExpression}`);
  
  if (dryRun) {
    console.log(`  [DRY RUN] Would update item`);
    return true;
  }
  
  // Perform the actual update
  try {
    const updateParams = {
      TableName: TABLE_NAME,
      Key: {
        pk: item.pk,
        sk: item.sk
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: attributeValues,
      ReturnValues: 'UPDATED_NEW'
    };
    
    await docClient.send(new UpdateCommand(updateParams));
    console.log(`  ✓ Successfully migrated`);
    return true;
    
  } catch (error) {
    console.error(`  ✗ Failed to migrate:`, error.message);
    return false;
  }
}

/**
 * Verify migration results
 */
async function verifyMigration() {
  console.log('\nVerifying migration...');
  
  const scanParams = {
    TableName: TABLE_NAME,
    FilterExpression: 'attribute_exists(gzCollectionId) OR attribute_exists(acCollectionId) OR attribute_exists(fcCollectionId)',
    Select: 'COUNT'
  };
  
  try {
    const result = await docClient.send(new ScanCommand(scanParams));
    console.log(`Items still with old field names: ${result.Count}`);
    
    if (result.Count === 0) {
      console.log('✓ Migration verification passed - no old field names found');
    } else {
      console.log('⚠ Migration verification failed - old field names still exist');
    }
    
    return result.Count === 0;
    
  } catch (error) {
    console.error('Error during verification:', error);
    return false;
  }
}

// Main script logic
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--execute');
  const isVerifyOnly = args.includes('--verify');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: 
  node migrate-collection-ids.js [options]

Options:
  --execute    Actually perform the migration (default is dry-run)
  --verify     Only verify migration results, don't migrate
  --local      Use local DynamoDB (localhost:8000)
  --help, -h   Show this help

Examples:
  # Dry run (safe, shows what would be changed)
  node migrate-collection-ids.js

  # Use local DynamoDB
  node migrate-collection-ids.js --local

  # Actually perform the migration on AWS
  node migrate-collection-ids.js --execute

  # Actually perform the migration on local DynamoDB
  node migrate-collection-ids.js --local --execute

  # Verify migration was successful
  node migrate-collection-ids.js --verify

Environment:
  TABLE_NAME             DynamoDB table name (default: reserve-rec-main)
  IS_OFFLINE             Set to 'true' to use local DynamoDB
  DYNAMODB_ENDPOINT_URL  Local DynamoDB endpoint (default: http://localhost:8000)
  AWS_REGION             AWS region (default: ca-central-1)
    `);
    process.exit(0);
  }
  
  try {
    if (isVerifyOnly) {
      await verifyMigration();
    } else {
      await migrateCollectionIds(isDryRun);
      
      if (!isDryRun) {
        console.log('\nRunning verification...');
        await verifyMigration();
      }
    }
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { migrateCollectionIds, verifyMigration };
