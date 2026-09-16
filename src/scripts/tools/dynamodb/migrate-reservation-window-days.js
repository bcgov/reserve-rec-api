/**
 * Reservation window: 2 weeks → 2 days  (Ref bcgov/reserve-rec-public#836)
 *
 * Day-use passes release "two days before your visit, starting at 7 am PT", but
 * every reservation policy's reservationWindow.open was written as
 * { weeks: 2 } instead of { days: 2 }. The 7am gate in the booking Lambda and the
 * public site therefore fires 14 days out and never bites on any date the site
 * offers, so the newly exposed day is bookable from midnight.
 *
 * This script:
 *   1. rewrites reservationWindow.open.duration to { days: 2 } on every
 *      policy::reservation::* record that still says { weeks: 2 };
 *   2. regenerates the baked reservationContext on the productDate rows (today
 *      onward) of every product pointing at one of those policies. Rows snapshot
 *      the resolved millis at creation, so step 1 alone changes nothing.
 *
 * Usage (DRY RUN — prints intended writes, writes nothing):
 *   TABLE_NAME=ReserveRecApi-Test-ReferenceDataStack-ReferenceDataTable \
 *   AWS_REGION=ca-central-1 DRY_RUN=1 node migrate-reservation-window-days.js
 *
 * Apply:  drop DRY_RUN.  Local:  add DYNAMODB_ENDPOINT_URL=http://localhost:8000
 */

'use strict';

const AWS = require('aws-sdk');
const { regenerateProductDates } = require('./lib/reservation-context');

const DRY_RUN = !!process.env.DRY_RUN;
const TABLE_NAME = process.env.TABLE_NAME || 'ReserveRecApi-Local-ReferenceDataStack-ReferenceDataTable';
const FROM_DATE = process.env.FROM_DATE || new Date().toISOString().slice(0, 10);

const ddb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'ca-central-1',
  ...(process.env.DYNAMODB_ENDPOINT_URL ? { endpoint: process.env.DYNAMODB_ENDPOINT_URL } : {}),
});

const log = (...a) => console.log(...a);

async function scanAll(params) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.scan({ TableName: TABLE_NAME, ...params, ExclusiveStartKey }).promise();
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function putItem(item, what) {
  log(`  ${DRY_RUN ? '[dry-run] would put' : 'put'}: ${what}`);
  if (!DRY_RUN) await ddb.put({ TableName: TABLE_NAME, Item: item }).promise();
}

// Returns the fixed policy, or null if its reservationWindow.open is not { weeks: 2 }.
function fixPolicy(policy) {
  const windows = policy.productDateRules?.temporalWindows || [];
  const resWindow = windows.find((w) => w.id === 'reservationWindow' && w.open?.anchorRef === 'productDate');
  const dur = resWindow?.open?.duration;
  if (!dur || dur.weeks !== 2 || Object.keys(dur).some((k) => !['direction', 'weeks'].includes(k))) return null;
  const fixed = JSON.parse(JSON.stringify(policy));
  const target = fixed.productDateRules.temporalWindows.find((w) => w.id === 'reservationWindow' && w.open?.anchorRef === 'productDate');
  target.open.duration = { direction: dur.direction || 'before', days: 2 };
  fixed.lastUpdated = new Date().toISOString();
  return fixed;
}

async function main() {
  log(`Reservation window 2w→2d — table=${TABLE_NAME} from=${FROM_DATE} ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);

  // 1. Policies.
  const policies = await scanAll({
    FilterExpression: 'begins_with(pk, :p)',
    ExpressionAttributeValues: { ':p': 'policy::reservation::' },
  });
  const fixed = new Map(); // pk -> fixed policy
  for (const policy of policies) {
    const f = fixPolicy(policy);
    if (f) fixed.set(policy.pk, f);
    else log(`  skip ${policy.pk} ${policy.sk}: reservationWindow.open is not { weeks: 2 }`);
  }
  log(`\nPolicies to fix (${fixed.size}/${policies.length}):`);
  for (const [pk, rec] of fixed) await putItem(rec, `${pk} ${rec.sk} (${rec.displayName})`);

  if (fixed.size === 0) {
    log('\nNothing to do.');
    return;
  }

  // 2. productDate rows of products on those policies.
  const products = await scanAll({
    FilterExpression: '#s = :schema',
    ExpressionAttributeNames: { '#s': 'schema' },
    ExpressionAttributeValues: { ':schema': 'product' },
  });
  const targets = products.filter((p) => fixed.has(p.reservationPolicy?.primaryKey?.pk));
  log(`\nRegenerating productDates (>= ${FROM_DATE}) for ${targets.length}/${products.length} products:`);
  let total = 0;
  for (const product of targets) {
    const policy = fixed.get(product.reservationPolicy.primaryKey.pk);
    const count = await regenerateProductDates(ddb, TABLE_NAME, product, policy, { dryRun: DRY_RUN, fromDate: FROM_DATE });
    total += count;
    log(`  ${product.displayName}  [${product.pk} sk=${product.sk}] → ${policy.pk}: ${DRY_RUN ? 'would regenerate' : 'regenerated'} ${count} row(s)`);
  }

  log(`\n${DRY_RUN ? `DRY RUN complete — ${total} productDate row(s) would be rewritten, no writes performed.` : `Migration complete — ${total} productDate row(s) rewritten.`}`);
}

main().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
