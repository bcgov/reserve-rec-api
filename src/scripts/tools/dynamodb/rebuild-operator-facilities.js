#!/usr/bin/env node
/**
 * Rebuild operator facilities  (Ref bcgov/reserve-rec-api#682)
 *
 * An operator record (pk `operator::<id>`, sk `base`) lists the parks it runs in
 * `orcs` and any other facilities in `extraFacilities`. The admin authorizer
 * reads the cached `facilities` map instead of querying for them on every
 * request. This script fills that cache: each park's facilities from
 * orcs-index (#678), plus the extra facilities.
 *
 * It writes only `facilities` and `facilitiesBuiltFrom` (the orcs and extras
 * the cache was built from), only when the cache changed, and only if the
 * operator's orcs and extras are still what it read. Every write leaves an
 * audit entry with the old and new cache.
 *
 * Run it after any change to an operator, or to a facility's orcs.
 *
 * Usage (dry run is the default; it writes nothing):
 *   TABLE_NAME=ReserveRecApi-Dev-ReferenceDataStack-ReferenceDataTable \
 *   AUDIT_TABLE_NAME=ReserveRecApi-Dev-ReferenceDataStack-AuditTable \
 *   AUDIT_USER=<your username> AWS_REGION=ca-central-1 \
 *   node src/scripts/tools/dynamodb/rebuild-operator-facilities.js
 *
 * Apply:  add --apply.
 */

'use strict';

const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const ORCS_INDEX_NAME = 'orcs-index';
const OPERATOR_PREFIX = 'operator::';
const FACILITY_KEY = /^[^:]+::[^:]+::[^:]+$/;

// `facility::bcparks_7` + `structure::3` → `bcparks_7::structure::3`
function facilityKey(item) {
  return `${item.pk.slice('facility::'.length)}::${item.sk}`;
}

// `bcparks_7::structure::3` → { pk: 'facility::bcparks_7', sk: 'structure::3' }
function facilityItemKey(key) {
  const [collectionId, facilityType, facilityId] = key.split('::');
  return { pk: `facility::${collectionId}`, sk: `${facilityType}::${facilityId}` };
}

// Why an operator's grant cannot be built from, or null when it can.
function grantProblem(operator) {
  const { orcs, extraFacilities = [] } = operator;
  if (!Array.isArray(orcs) || !orcs.every((o) => Number.isInteger(o) && o > 0)) return 'orcs is not a list of park numbers';
  if (!Array.isArray(extraFacilities) || !extraFacilities.every((k) => typeof k === 'string' && FACILITY_KEY.test(k))) {
    return 'extraFacilities is not a list of facility keys';
  }
  return null;
}

// facility items → { key: { orcs, displayName } }, sorted by key so equal caches compare equal
function buildFacilities(items) {
  const entries = items.map((item) => [facilityKey(item), { orcs: item.orcs ?? null, displayName: item.displayName ?? null }]);
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
}

// A stored map comes back in any key order, so compare sorted entries.
function sameFacilities(a, b) {
  const entries = (map = {}) => Object.keys(map).sort().map((key) => [key, map[key]?.orcs ?? null, map[key]?.displayName ?? null]);
  return JSON.stringify(entries(a)) === JSON.stringify(entries(b));
}

// Same shape writeAuditLog (/opt/base) writes.
function auditRecord(user, operatorId, oldFacilities, newFacilities, timestamp, uuid) {
  const entityId = `${OPERATOR_PREFIX}${operatorId}`;
  return {
    pk: user,
    sk: `${timestamp}#${uuid}`,
    gsipk: `entity::${entityId}`,
    gsisk: timestamp,
    operation: 'OPERATOR-FACILITIES-REBUILD',
    metadata: { entityId, oldFacilities: oldFacilities ?? null, newFacilities, source: 'rebuild-operator-facilities', timestamp },
  };
}

// Only write if orcs and extraFacilities are still what we built from.
function updateParams(tableName, operator, facilities) {
  const builtFrom = { orcs: operator.orcs, extraFacilities: operator.extraFacilities ?? [] };
  const hasExtras = operator.extraFacilities !== undefined;
  return {
    TableName: tableName,
    Key: { pk: operator.pk, sk: operator.sk },
    UpdateExpression: 'SET #facilities = :facilities, #builtFrom = :builtFrom',
    ConditionExpression: `#orcs = :orcs AND ${hasExtras ? '#extra = :extra' : 'attribute_not_exists(#extra)'}`,
    ExpressionAttributeNames: { '#facilities': 'facilities', '#builtFrom': 'facilitiesBuiltFrom', '#orcs': 'orcs', '#extra': 'extraFacilities' },
    ExpressionAttributeValues: {
      ':facilities': facilities,
      ':builtFrom': builtFrom,
      ':orcs': operator.orcs,
      ...(hasExtras ? { ':extra': operator.extraFacilities } : {}),
    },
  };
}

// Every page of a Query or Scan.
async function readAll(doc, Command, input) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await doc.send(new Command({ ...input, ExclusiveStartKey }));
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

function listOperators(doc, tableName) {
  return readAll(doc, ScanCommand, {
    TableName: tableName,
    FilterExpression: 'begins_with(pk, :prefix) AND sk = :base',
    ExpressionAttributeValues: { ':prefix': OPERATOR_PREFIX, ':base': 'base' },
  });
}

// orcs-index holds anything with a numeric orcs, so keep only facilities.
async function parkFacilities(doc, tableName, orcs) {
  const items = await readAll(doc, QueryCommand, {
    TableName: tableName,
    IndexName: ORCS_INDEX_NAME,
    KeyConditionExpression: '#orcs = :orcs',
    ExpressionAttributeNames: { '#orcs': 'orcs' },
    ExpressionAttributeValues: { ':orcs': orcs },
  });
  return items.filter((item) => item.pk.startsWith('facility::'));
}

// Returns 'unchanged', 'updated' (or would be, on a dry run) or 'invalid'.
async function rebuildOperator(doc, { tableName, auditTableName, auditUser, apply }, operator, log = console.log) {
  const id = operator.pk.slice(OPERATOR_PREFIX.length);
  const problem = grantProblem(operator);
  if (problem) {
    log(`  ${id}: SKIPPED, ${problem}`);
    return 'invalid';
  }

  const items = [];
  for (const orcs of operator.orcs) items.push(...await parkFacilities(doc, tableName, orcs));
  for (const key of operator.extraFacilities ?? []) {
    const item = (await doc.send(new GetCommand({ TableName: tableName, Key: facilityItemKey(key) }))).Item;
    if (item) items.push(item);
    else log(`  ${id}: extra facility ${key} not found, left out`);
  }
  const facilities = buildFacilities(items);

  // The grant counts too, so facilitiesBuiltFrom never lags behind orcs and extras.
  const grant = { orcs: operator.orcs, extraFacilities: operator.extraFacilities ?? [] };
  if (sameFacilities(operator.facilities, facilities) && JSON.stringify(operator.facilitiesBuiltFrom) === JSON.stringify(grant)) {
    log(`  ${id}: unchanged (${Object.keys(facilities).length} facilities)`);
    return 'unchanged';
  }
  log(`  ${id}: ${apply ? '' : '[dry-run] would '}set ${Object.keys(facilities).length} facilities: ${Object.keys(facilities).join(', ') || 'none'}`);
  if (!apply) return 'updated';

  await doc.send(new UpdateCommand(updateParams(tableName, operator, facilities)));
  const timestamp = new Date().toISOString();
  await doc.send(new PutCommand({ TableName: auditTableName, Item: auditRecord(auditUser, id, operator.facilities, facilities, timestamp, crypto.randomUUID()) }));
  return 'updated';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tableName = process.env.TABLE_NAME;
  const auditTableName = process.env.AUDIT_TABLE_NAME;
  const auditUser = process.env.AUDIT_USER;
  if (!tableName || !auditTableName || !auditUser) throw new Error('TABLE_NAME, AUDIT_TABLE_NAME and AUDIT_USER are required');

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'ca-central-1' }));
  console.log(`Rebuild operator facilities — table=${tableName} ${apply ? '(APPLY)' : '(DRY RUN)'}`);

  const counts = { unchanged: 0, updated: 0, invalid: 0 };
  for (const operator of await listOperators(doc, tableName)) {
    counts[await rebuildOperator(doc, { tableName, auditTableName, auditUser, apply }, operator)]++;
  }
  console.log(`\n${counts.updated} ${apply ? 'updated' : 'would be updated'}, ${counts.unchanged} unchanged, ${counts.invalid} skipped as invalid.`);
  if (counts.invalid) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((e) => { console.error('Rebuild failed:', e); process.exit(1); });
}

module.exports = { facilityKey, facilityItemKey, grantProblem, buildFacilities, sameFacilities, auditRecord, updateParams, rebuildOperator };
