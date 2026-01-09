#!/usr/bin/env node

/**
 * Migration script to regenerate and standardize searchTerms for geozones, facilities, and activities
 * Extracts keywords from displayName, description, activityType, activitySubType, and existing searchTerms
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const TABLE_NAME = process.env.TABLE_NAME || 'ReserveRecApi-Local-ReferenceDataTable';

const options = {
  region: AWS_REGION,
};

if (process.env?.IS_OFFLINE === 'true') {
  options.endpoint = DYNAMODB_ENDPOINT_URL;
}

const client = new DynamoDBClient(options);
const docClient = DynamoDBDocumentClient.from(client);

// Common stop words to exclude from search terms
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in', 'into',
  'is', 'it', 'no', 'not', 'of', 'on', 'or', 'such', 'that', 'the', 'their', 'then',
  'there', 'these', 'they', 'this', 'to', 'was', 'will', 'with'
]);

// Target schemas to update
const TARGET_SCHEMAS = ['geozone', 'facility', 'activity'];

/**
 * Split camelCase or PascalCase words into separate words
 * Examples:
 *   backcountryCamp -> ['backcountry', 'camp']
 *   frontcountryCabin -> ['frontcountry', 'cabin']
 */
function splitCamelCase(word) {
  if (!word) return [];
  
  // Insert space before capital letters and split
  const split = word
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/);
  
  return split;
}

/**
 * Extract and clean words from a text string
 */
function extractWords(text) {
  if (!text) return [];
  
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // Remove special characters
    .split(/\s+/) // Split by whitespace
    .filter(word => word.length > 2) // Minimum 3 characters
    .filter(word => !STOP_WORDS.has(word)); // Remove stop words
}

/**
 * Generate searchTerms array from item attributes
 */
function generateSearchTerms(item) {
  const terms = new Set();
  
  // 1. Add existing searchTerms
  if (item.searchTerms) {
    let existingTerms = [];
    
    if (Array.isArray(item.searchTerms)) {
      existingTerms = item.searchTerms;
    } else if (typeof item.searchTerms === 'string') {
      // Handle comma-separated strings
      existingTerms = item.searchTerms
        .split(',')
        .map(term => term.trim())
        .filter(term => term.length > 0);
    }
    
    existingTerms.forEach(term => {
      extractWords(term).forEach(word => terms.add(word));
    });
  }
  
  // 2. Add schema
  if (item.schema) {
    extractWords(item.schema).forEach(word => terms.add(word));
  }
  
  // 3. Add displayName
  if (item.displayName) {
    extractWords(item.displayName).forEach(word => terms.add(word));
  }
  
  // 4. Add description
  if (item.description) {
    extractWords(item.description).forEach(word => terms.add(word));
  }
  
  // 5. Add activityType (split camelCase)
  if (item.activityType) {
    splitCamelCase(item.activityType).forEach(word => {
      extractWords(word).forEach(w => terms.add(w));
    });
  }
  
  // 6. Add activitySubType
  if (item.activitySubType) {
    splitCamelCase(item.activitySubType).forEach(word => {
      extractWords(word).forEach(w => terms.add(w));
    });
  }
  
  // Convert to sorted array
  return Array.from(terms).sort();
}

/**
 * Scan and migrate items in batches
 */
async function migrateSearchTerms(dryRun = true) {
  console.log(`Starting search terms migration - Dry Run: ${dryRun}`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Target schemas: ${TARGET_SCHEMAS.join(', ')}`);
  
  let totalScanned = 0;
  let totalMigrated = 0;
  let lastEvaluatedKey = null;
  
  do {
    const scanParams = {
      TableName: TABLE_NAME,
      FilterExpression: '#schema IN (:geozone, :facility, :activity)',
      ExpressionAttributeNames: {
        '#schema': 'schema'
      },
      ExpressionAttributeValues: {
        ':geozone': 'geozone',
        ':facility': 'facility',
        ':activity': 'activity'
      },
      Limit: 100
    };
    
    // Only add ExclusiveStartKey if we have a valid lastEvaluatedKey
    if (lastEvaluatedKey) {
      scanParams.ExclusiveStartKey = lastEvaluatedKey;
    }
    
    try {
      const result = await docClient.send(new ScanCommand(scanParams));
      
      totalScanned += result.Items.length;
      console.log(`Scanned ${result.Items.length} items (Total: ${totalScanned})`);
      
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
  const newSearchTerms = generateSearchTerms(item);
  
  // Check if searchTerms actually changed
  const existingSearchTerms = Array.isArray(item.searchTerms) 
    ? item.searchTerms.sort() 
    : [];
  
  const hasChanged = JSON.stringify(existingSearchTerms) !== JSON.stringify(newSearchTerms);
  
  if (!hasChanged) {
    return false;
  }
  
  console.log(`\nMigrating item: pk=${item.pk}, sk=${item.sk}`);
  console.log(`  Schema: ${item.schema}`);
  console.log(`  Old searchTerms (${existingSearchTerms.length}):`, existingSearchTerms.slice(0, 5), existingSearchTerms.length > 5 ? '...' : '');
  console.log(`  New searchTerms (${newSearchTerms.length}):`, newSearchTerms.slice(0, 5), newSearchTerms.length > 5 ? '...' : '');
  
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
      UpdateExpression: 'SET searchTerms = :searchTerms',
      ExpressionAttributeValues: {
        ':searchTerms': newSearchTerms
      },
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
 * Verify migration results - sample check
 */
async function verifyMigration() {
  console.log('\nVerifying migration...');
  
  const scanParams = {
    TableName: TABLE_NAME,
    FilterExpression: '#schema IN (:geozone, :facility, :activity)',
    ExpressionAttributeNames: {
      '#schema': 'schema'
    },
    ExpressionAttributeValues: {
      ':geozone': 'geozone',
      ':facility': 'facility',
      ':activity': 'activity'
    },
    Limit: 10
  };
  
  try {
    const result = await docClient.send(new ScanCommand(scanParams));
    console.log(`\nSample verification (${result.Items.length} items):`);
    
    result.Items.forEach(item => {
      console.log(`\n${item.schema}: ${item.displayName || item.pk}`);
      console.log(`  searchTerms (${item.searchTerms?.length || 0}):`, 
        Array.isArray(item.searchTerms) ? item.searchTerms.slice(0, 10).join(', ') : item.searchTerms);
    });
    
    return true;
    
  } catch (error) {
    console.error('Error during verification:', error);
    return false;
  }
}

/**
 * Main script execution
 */
async function main() {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--execute');
  const isVerifyOnly = args.includes('--verify');
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: 
  node migrate-search-terms.js [options]

Options:
  --execute    Actually perform the migration (default is dry-run)
  --verify     Only verify migration results, don't migrate
  --local      Use local DynamoDB (localhost:8000)
  --help, -h   Show this help

Examples:
  # Dry run (safe, shows what would be changed)
  node migrate-search-terms.js

  # Use local DynamoDB (dry run)
  IS_OFFLINE=true node migrate-search-terms.js

  # Actually perform the migration on local DynamoDB
  IS_OFFLINE=true node migrate-search-terms.js --execute

  # Verify migration was successful
  IS_OFFLINE=true node migrate-search-terms.js --verify

Environment:
  TABLE_NAME             DynamoDB table name (default: ReserveRecApi-Local-ReferenceDataTable)
  IS_OFFLINE             Set to 'true' to use local DynamoDB
  DYNAMODB_ENDPOINT_URL  Local DynamoDB endpoint (default: http://localhost:8000)
  AWS_REGION             AWS region (default: ca-central-1)

Extracted Fields:
  - Existing searchTerms (comma-separated strings or arrays)
  - schema
  - displayName
  - description (stop words removed)
  - activityType (camelCase split, e.g., backcountryCamp → backcountry, camp)
  - activitySubType (camelCase split)

Stop Words Excluded:
  ${Array.from(STOP_WORDS).join(', ')}
    `);
    process.exit(0);
  }
  
  try {
    if (isVerifyOnly) {
      await verifyMigration();
    } else {
      await migrateSearchTerms(isDryRun);
      
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

module.exports = { migrateSearchTerms, verifyMigration, generateSearchTerms };
