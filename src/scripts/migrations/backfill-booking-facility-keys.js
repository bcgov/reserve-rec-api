#!/usr/bin/env node

// Backfill `facilityKeys` on bookings that lack it, by the booking-creation rule (src/common/facility-keys.js).
// An activity with no facility link gives `[]`; several links stop it before any write. --help prints the migration steps.

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { facilityKeysFromLinks } = require('../../common/facility-keys');

const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000';
const AWS_REGION = process.env.AWS_REGION || 'ca-central-1';
const MIGRATION_STEPS = `Migration steps, in each environment (Dev, Test, Prod):
  1. Add the mapping first, or dynamic mapping makes the field text and needs a reindex:
       PUT <OPENSEARCH_TRANSACTIONAL_DATA_INDEX_NAME>/_mapping
       { "properties": { "facilityKeys": { "type": "keyword" } } }
  2. Dry run (the default) and read the plan and any STOP lines; an activity
     with no facility link is planned with facilityKeys [], not stopped.
  3. Back up the transactional data table (on-demand backup) before the Prod run.
  4. Real run with --execute; it ends with a scan that must find no booking without facilityKeys.`;

const TABLES = {
  transactional: process.env.TRANSACTIONAL_DATA_TABLE_NAME || 'transactional-data',
  reference: process.env.REFERENCE_DATA_TABLE_NAME || 'reference-data',
  relationshipIndex: process.env.ENTITY_RELATIONSHIP_INDEX || 'entityRelationship-index',
};

function createDocClient() {
  const options = { region: AWS_REGION };
  if (process.env?.IS_OFFLINE === 'true') {
    options.endpoint = DYNAMODB_ENDPOINT_URL;
  }
  return DynamoDBDocumentClient.from(new DynamoDBClient(options));
}

// Every page of a Scan or Query.
async function collect(docClient, Command, params) {
  const items = [];
  let lastEvaluatedKey;
  do {
    const page = lastEvaluatedKey ? { ...params, ExclusiveStartKey: lastEvaluatedKey } : params;
    const result = await docClient.send(new Command(page));
    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
  return items;
}

function scanBookingsWithoutFacilityKeys(docClient, tables) {
  return collect(docClient, ScanCommand, {
    TableName: tables.transactional,
    FilterExpression: '#schema = :booking AND attribute_not_exists(facilityKeys)',
    ExpressionAttributeNames: { '#schema': 'schema' },
    ExpressionAttributeValues: { ':booking': 'booking' },
  });
}

async function activityFacilityKeys(docClient, tables, activity) {
  const links = await collect(docClient, QueryCommand, {
    TableName: tables.reference,
    IndexName: tables.relationshipIndex,
    KeyConditionExpression: 'gsipk = :gsipk AND begins_with(gsisk, :facility)',
    ExpressionAttributeValues: { ':gsipk': `rel::activity::${activity}`, ':facility': 'facility::' },
  });
  return facilityKeysFromLinks(links);
}

// Reads bookings without facilityKeys and their activities' facility links; writes nothing.
async function planBackfill(docClient, tables = TABLES) {
  const bookings = await scanBookingsWithoutFacilityKeys(docClient, tables);
  console.log(`Bookings without facilityKeys: ${bookings.length}`);

  const keysByActivity = new Map();
  const updates = [];
  const problems = [];

  for (const booking of bookings) {
    const { collectionId, activityType, activityId } = booking;
    if (!collectionId || !activityType || !activityId) {
      problems.push(`booking ${booking.pk} ${booking.sk}: no collectionId, activityType or activityId`);
      continue;
    }
    const activity = `${collectionId}::${activityType}::${activityId}`;
    if (!keysByActivity.has(activity)) {
      const { keys, skipped } = await activityFacilityKeys(docClient, tables, activity);
      skipped.forEach((link) => console.log(`  activity ${activity}: ignoring link ${link.pk1} ${link.sk1}, not a facility`));
      keysByActivity.set(activity, keys);
      if (keys.length > 1) {
        problems.push(`activity ${activity}: ${keys.length} facility links (${keys.join(', ')})`);
      }
    }
    const keys = keysByActivity.get(activity);
    if (keys.length <= 1) {
      updates.push({ pk: booking.pk, sk: booking.sk, activity, facilityKeys: keys });
    }
  }

  for (const [activity, keys] of keysByActivity) {
    const count = updates.filter((update) => update.activity === activity).length;
    if (count) console.log(`  ${activity} -> ${keys[0] ?? '[] (no facility link)'}: ${count} booking(s)`);
  }
  return { updates, problems };
}

// The condition leaves a booking that gained facilityKeys since the plan alone, counted as already set.
async function applyBackfill(docClient, updates, tables = TABLES) {
  const counts = { set: 0, alreadySet: 0 };
  for (const { pk, sk, facilityKeys } of updates) {
    try {
      await docClient.send(new UpdateCommand({
        TableName: tables.transactional,
        Key: { pk, sk },
        UpdateExpression: 'SET facilityKeys = :facilityKeys',
        ConditionExpression: 'attribute_exists(pk) AND attribute_not_exists(facilityKeys)',
        ExpressionAttributeValues: { ':facilityKeys': facilityKeys },
      }));
      counts.set++;
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') throw error;
      counts.alreadySet++;
    }
  }
  return counts;
}

async function verifyBackfill(docClient, tables = TABLES) {
  const missing = await scanBookingsWithoutFacilityKeys(docClient, tables);
  console.log(`Bookings still without facilityKeys: ${missing.length}`);
  missing.slice(0, 20).forEach((booking) => console.log(`  ${booking.pk} ${booking.sk}`));
  return missing.length === 0;
}

async function backfill({ docClient, dryRun = true, tables = TABLES }) {
  console.log(`Booking facilityKeys backfill - Dry Run: ${dryRun}`);
  console.log(`Tables: ${tables.transactional} (bookings), ${tables.reference} (relationships, ${tables.relationshipIndex})`);

  const { updates, problems } = await planBackfill(docClient, tables);
  if (problems.length > 0) {
    problems.forEach((problem) => console.error(`  STOP ${problem}`));
    throw new Error(`Stopped before any write: ${problems.length} problem(s); each activity needs at most one facility link`);
  }

  if (dryRun) {
    console.log(`\n[DRY RUN] Would set facilityKeys on ${updates.length} booking(s)`);
    return { planned: updates.length, set: 0, alreadySet: 0 };
  }

  const counts = await applyBackfill(docClient, updates, tables);
  console.log(`\nSet facilityKeys on ${counts.set} booking(s); ${counts.alreadySet} already had it`);
  if (!(await verifyBackfill(docClient, tables))) {
    throw new Error('Verification failed: bookings without facilityKeys remain');
  }
  return { planned: updates.length, ...counts };
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  node backfill-booking-facility-keys.js [options]

Options:
  --execute    Write facilityKeys (default is dry-run)
  --verify     Only count bookings without facilityKeys
  --help, -h   Show this help

${MIGRATION_STEPS}

Examples:
  # Dry run (safe, writes nothing)
  TRANSACTIONAL_DATA_TABLE_NAME=<table> REFERENCE_DATA_TABLE_NAME=<table> node backfill-booking-facility-keys.js

  # Against local DynamoDB
  IS_OFFLINE=true node backfill-booking-facility-keys.js --execute

Environment:
  TRANSACTIONAL_DATA_TABLE_NAME  Bookings table (default: transactional-data)
  REFERENCE_DATA_TABLE_NAME      Relationships table (default: reference-data)
  ENTITY_RELATIONSHIP_INDEX      Relationship GSI (default: entityRelationship-index)
  IS_OFFLINE                     Set to 'true' to use local DynamoDB
  DYNAMODB_ENDPOINT_URL          Local DynamoDB endpoint (default: http://localhost:8000)
  AWS_REGION                     AWS region (default: ca-central-1)
    `);
    process.exit(0);
  }

  const docClient = createDocClient();
  try {
    if (args.includes('--verify')) {
      if (!(await verifyBackfill(docClient))) process.exit(1);
    } else {
      await backfill({ docClient, dryRun: !args.includes('--execute') });
    }
  } catch (error) {
    console.error('Backfill failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { applyBackfill, backfill, planBackfill, verifyBackfill };
