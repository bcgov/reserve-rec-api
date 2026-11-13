/**
 * Facility ORCS backfill  (Ref bcgov/reserve-rec-api#678)
 *
 * Sets `orcs` (the park number) on the existing facilities, so the orcs-index
 * can list a park's facilities. Run after the deploy that adds orcs-index.
 *
 * For each facility below it:
 *   - skips it if it does not exist, or already has this orcs;
 *   - otherwise sets orcs and writes an audit entry (old and new value, caller),
 *     the same shape the facility API writes.
 * Then it queries orcs-index for each park and fails if the result is not
 * exactly that park's facilities.
 *
 * Usage (DRY RUN — prints intended writes, writes nothing):
 *   TABLE_NAME=ReserveRecApi-Dev-ReferenceDataStack-ReferenceDataTable \
 *   AUDIT_TABLE_NAME=ReserveRecApi-Dev-ReferenceDataStack-AuditTable \
 *   AUDIT_USER=<your username> AWS_REGION=ca-central-1 DRY_RUN=1 \
 *   node backfill-facility-orcs.js
 *
 * Apply:  drop DRY_RUN.  Local:  add DYNAMODB_ENDPOINT_URL=http://localhost:8000
 */

'use strict';

const AWS = require('aws-sdk');

// Facility (pk, sk) → orcs. From the table in #678.
const FACILITY_ORCS = [
  ['facility::bcparks_7', 'structure::1', 7], // Cheakamus
  ['facility::bcparks_7', 'structure::2', 7], // Diamond Head
  ['facility::bcparks_7', 'structure::3', 7], // Rubble Creek
  ['facility::bcparks_8', 'structure::1', 8], // Golden Ears lots
  ['facility::bcparks_8', 'structure::2', 8],
  ['facility::bcparks_8', 'structure::3', 8],
  ['facility::bcparks_8', 'structure::4', 8],
  ['facility::bcparks_15', 'structure::1', 15], // Mount Seymour lots
  ['facility::bcparks_15', 'structure::2', 15],
  ['facility::bcparks_363', 'trail::1', 363], // Joffre Lakes
];

const ORCS_INDEX_NAME = 'orcs-index';

// What to do for one facility: 'missing', 'unchanged' or 'set'.
function planFacility(stored, orcs) {
  if (!stored) return 'missing';
  if (stored.orcs === orcs) return 'unchanged';
  return 'set';
}

// The audit entry the facility API writes for an orcs change (writeAuditLog in /opt/base).
function auditRecord(user, pk, sk, oldOrcs, newOrcs, timestamp) {
  const entityId = `${pk}::${sk}`;
  return {
    pk: user,
    sk: timestamp,
    gsipk: `entity::${entityId}`,
    gsisk: timestamp,
    operation: 'FACILITY-ORCS-UPDATE',
    metadata: { entityId, oldOrcs, newOrcs, source: 'backfill-facility-orcs', timestamp },
  };
}

async function main() {
  const DRY_RUN = !!process.env.DRY_RUN;
  const TABLE_NAME = process.env.TABLE_NAME;
  const AUDIT_TABLE_NAME = process.env.AUDIT_TABLE_NAME;
  const AUDIT_USER = process.env.AUDIT_USER;
  if (!TABLE_NAME || !AUDIT_TABLE_NAME || !AUDIT_USER) {
    throw new Error('TABLE_NAME, AUDIT_TABLE_NAME and AUDIT_USER are required');
  }

  const ddb = new AWS.DynamoDB.DocumentClient({
    region: process.env.AWS_REGION || 'ca-central-1',
    ...(process.env.DYNAMODB_ENDPOINT_URL ? { endpoint: process.env.DYNAMODB_ENDPOINT_URL } : {}),
  });

  console.log(`Facility orcs backfill — table=${TABLE_NAME} ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);
  const counts = { set: 0, unchanged: 0, missing: 0 };

  for (const [pk, sk, orcs] of FACILITY_ORCS) {
    const stored = (await ddb.get({ TableName: TABLE_NAME, Key: { pk, sk } }).promise()).Item;
    const plan = planFacility(stored, orcs);
    counts[plan]++;
    const name = stored?.displayName ? ` (${stored.displayName})` : '';
    if (plan === 'missing') {
      console.log(`  skip ${pk} ${sk}: not found`);
      continue;
    }
    if (plan === 'unchanged') {
      console.log(`  skip ${pk} ${sk}${name}: already orcs ${orcs}`);
      continue;
    }
    const oldOrcs = stored.orcs ?? null;
    console.log(`  ${DRY_RUN ? '[dry-run] would set' : 'set'} ${pk} ${sk}${name}: orcs ${oldOrcs} → ${orcs}`);
    if (DRY_RUN) continue;

    const now = new Date().toISOString();
    await ddb.update({
      TableName: TABLE_NAME,
      Key: { pk, sk },
      UpdateExpression: 'SET #orcs = :orcs, #lastUpdated = :now',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeNames: { '#orcs': 'orcs', '#lastUpdated': 'lastUpdated' },
      ExpressionAttributeValues: { ':orcs': orcs, ':now': now },
    }).promise();
    await ddb.put({ TableName: AUDIT_TABLE_NAME, Item: auditRecord(AUDIT_USER, pk, sk, oldOrcs, orcs, now) }).promise();
  }

  console.log(`\n${counts.set} ${DRY_RUN ? 'would be set' : 'set'}, ${counts.unchanged} already set, ${counts.missing} not found.`);
  if (DRY_RUN) return;

  // Check: each park's orcs-index Query returns exactly its facilities.
  let ok = true;
  for (const orcs of [...new Set(FACILITY_ORCS.map(([, , o]) => o))]) {
    const res = await ddb.query({
      TableName: TABLE_NAME,
      IndexName: ORCS_INDEX_NAME,
      KeyConditionExpression: '#orcs = :orcs',
      ExpressionAttributeNames: { '#orcs': 'orcs' },
      ExpressionAttributeValues: { ':orcs': orcs },
    }).promise();
    const got = (res.Items || []).map((i) => `${i.pk}::${i.sk}`).sort();
    const want = FACILITY_ORCS.filter(([, , o]) => o === orcs).map(([pk, sk]) => `${pk}::${sk}`).sort();
    const match = JSON.stringify(got) === JSON.stringify(want);
    ok = ok && match;
    console.log(`  orcs ${orcs}: ${match ? 'ok' : `MISMATCH, got ${got.join(', ') || 'nothing'}`}`);
  }
  if (!ok) throw new Error('orcs-index check failed (the index can lag a few seconds; re-run to recheck)');
}

if (require.main === module) {
  main().catch((e) => { console.error('Backfill failed:', e); process.exit(1); });
}

module.exports = { FACILITY_ORCS, planFacility, auditRecord };
