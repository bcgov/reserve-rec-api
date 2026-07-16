/**
 * AM/PM Day-Use Policy Migration  (Ref bcgov/reserve-rec-admin#279)
 *
 * Creates distinct AM / PM reservation policies with time-of-day windows, points
 * each "- AM" / "- PM" product at the policy matching its facility, and regenerates
 * the stored reservationContext on that product's productDate rows so bookings
 * enforce the new check-in / check-out / reservation-window times.
 *
 * Data-driven: WINDOW_CONFIG below has a `default` window set plus optional
 * per-facility (collectionId) `overrides`. Identical window sets are de-duplicated
 * into a single shared policy, so the happy path (no overrides) yields just two
 * policies (AM, PM). Windows are seasonal — edit the hours and re-run each season.
 * "All day" products are left on the existing policy::reservation::1 (7:00–17:00).
 *
 * Usage (DRY RUN — prints intended writes, writes nothing):
 *   TABLE_NAME=ReserveRecApi-Test-ReferenceDataStack-ReferenceDataTable \
 *   AWS_REGION=ca-central-1 DRY_RUN=1 node migrate-am-pm-policies.js
 *
 * Apply:  drop DRY_RUN.  Local:  add DYNAMODB_ENDPOINT_URL=http://localhost:8000
 */

'use strict';

const path = require('path');
const AWS = require('aws-sdk');

// ── Reuse the REAL temporal resolver (pure luxon math) by shimming the Lambda
//    layer paths it imports. base.js gives exact epoch math (no drift); the
//    resolver never calls the dynamodb layer, so that one is stubbed. ──────────
const Module = require('module');
const origLoad = Module._load;
const BASE_PATH = path.resolve(__dirname, '../../../layers/base/base.js');
Module._load = function (request, ...rest) {
  if (request === '/opt/base') return origLoad.call(this, BASE_PATH, ...rest);
  if (request === '/opt/dynamodb') {
    return { getOne: async () => null, marshall: (x) => x, runQuery: async () => ({ items: [] }), batchGetData: async () => [], REFERENCE_DATA_TABLE_NAME: process.env.TABLE_NAME };
  }
  return origLoad.call(this, request, ...rest);
};
const { resolveTemporalAnchor, resolveTemporalWindow } = require(path.resolve(__dirname, '../../../common/data-utils.js'));

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — seasonal window hours. Edit + re-run each season.
// ─────────────────────────────────────────────────────────────────────────────
const SEASON_LABEL = 'Summer 2026';
const WINDOW_CONFIG = {
  // checkIn / checkOut hours (local park time). reservationWindow closes at checkOut,
  // so a pass is not bookable for the same day after its window ends.
  default: {
    AM: { in: 7, out: 13 },   // 7:00 arrival, expires 13:00
    PM: { in: 13, out: 17 },  // 1:00PM arrival, expires 17:00
  },
  // Per-facility overrides, keyed by collectionId. Empty = uniform (happy path).
  // Example: overrides: { bcparks_7: { PM: { in: 13, out: 20 } } }
  overrides: {},
};

const BASE_POLICY_KEY = { pk: 'policy::reservation::1', sk: 'v1' };
const DRY_RUN = !!process.env.DRY_RUN;
const TABLE_NAME = process.env.TABLE_NAME || 'ReserveRecApi-Local-ReferenceDataStack-ReferenceDataTable';

const ddb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'ca-central-1',
  ...(process.env.DYNAMODB_ENDPOINT_URL ? { endpoint: process.env.DYNAMODB_ENDPOINT_URL } : {}),
});

const log = (...a) => console.log(...a);
const nowISO = () => new Date().toISOString();

// ── helpers ──────────────────────────────────────────────────────────────────

function effectiveWindows(collectionId, period) {
  return WINDOW_CONFIG.overrides?.[collectionId]?.[period] || WINDOW_CONFIG.default[period];
}

// Distinct policies are keyed by their window signature so facilities sharing a
// window set share one policy (default → readable am/pm pk; overrides → suffixed).
function policyKeyFor(period, win) {
  const isDefault = win.in === WINDOW_CONFIG.default[period].in && win.out === WINDOW_CONFIG.default[period].out;
  const slug = isDefault ? period.toLowerCase() : `${period.toLowerCase()}-${win.in}${win.out}`;
  return `policy::reservation::${slug}`;
}

// Clone the base all-day policy and override the time-of-day anchors/window.
function buildPolicyRecord(basePolicy, period, win, pk) {
  const policy = JSON.parse(JSON.stringify(basePolicy));
  policy.pk = pk;
  policy.sk = 'v1';
  policy.displayName = `${period} Day Use Reservation Policy (${SEASON_LABEL})`;
  policy.lastUpdated = nowISO();

  const anchors = policy.productDateRules?.temporalAnchors || [];
  for (const a of anchors) {
    if (a.id === 'checkInTime') a.timeOfDay = { ...a.timeOfDay, hour: win.in };
    if (a.id === 'checkOutTime') a.timeOfDay = { ...a.timeOfDay, hour: win.out };
  }
  const windows = policy.productDateRules?.temporalWindows || [];
  for (const w of windows) {
    if (w.id === 'reservationWindow' && w.close?.timeOfDay) {
      w.close.timeOfDay = { ...w.close.timeOfDay, hour: win.out };
    }
  }
  return policy;
}

// Mirror of resolveProductDateReservationContext (productDates/methods.js) so
// regenerated rows match what the live init path would produce.
function resolveReservationContext(product, date, policy) {
  const pdr = policy?.productDateRules;
  const refStore = { productDate: date };
  const ra = {};
  const rw = {};
  for (const a of (pdr?.temporalAnchors || [])) ra[a.id] = resolveTemporalAnchor(a, product?.timezone, refStore).millis;
  for (const w of (pdr?.temporalWindows || [])) rw[w.id] = resolveTemporalWindow(w, product?.timezone, refStore);
  return {
    isDiscoverable: pdr?.isDiscoverable || true,
    isReservable: pdr?.isReservable || true,
    minDailyInventory: pdr?.minDailyInventory || 1,
    maxDailyInventory: pdr?.maxDailyInventory || 1,
    temporalAnchors: ra,
    temporalWindows: rw,
  };
}

function classifyPeriod(displayName) {
  if (/\s-\sAM$/.test(displayName || '')) return 'AM';
  if (/\s-\sPM$/.test(displayName || '')) return 'PM';
  return null; // All-day / other → leave as-is
}

async function scanBySchema(schema) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb.scan({
      TableName: TABLE_NAME,
      FilterExpression: '#s = :schema',
      ExpressionAttributeNames: { '#s': 'schema' },
      ExpressionAttributeValues: { ':schema': schema },
      ExclusiveStartKey,
    }).promise();
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function putItem(item, what) {
  log(`  ${DRY_RUN ? '[dry-run] would put' : 'put'}: ${what}`);
  if (!DRY_RUN) await ddb.put({ TableName: TABLE_NAME, Item: item }).promise();
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  log(`AM/PM policy migration — table=${TABLE_NAME} region=${process.env.AWS_REGION || 'ca-central-1'} ${DRY_RUN ? '(DRY RUN)' : '(APPLY)'}`);

  const baseRes = await ddb.get({ TableName: TABLE_NAME, Key: BASE_POLICY_KEY }).promise();
  const basePolicy = baseRes.Item;
  if (!basePolicy) throw new Error(`Base policy ${BASE_POLICY_KEY.pk} not found — cannot clone.`);
  log(`Loaded base policy: ${basePolicy.displayName}`);

  // 1. Determine the distinct policies needed (default + overrides), de-duped.
  const products = await scanBySchema('product');
  log(`Scanned ${products.length} products.`);

  const neededPolicies = new Map(); // pk -> policy record
  const productTargets = [];        // { product, period, policyPk }
  for (const product of products) {
    const period = classifyPeriod(product.displayName);
    if (!period) continue;
    const win = effectiveWindows(product.collectionId, period);
    const pk = policyKeyFor(period, win);
    if (!neededPolicies.has(pk)) neededPolicies.set(pk, buildPolicyRecord(basePolicy, period, win, pk));
    productTargets.push({ product, period, policyPk: pk });
  }

  log(`\nPolicies to create/update (${neededPolicies.size}):`);
  for (const [pk, rec] of neededPolicies) {
    const a = rec.productDateRules.temporalAnchors;
    const ci = a.find((x) => x.id === 'checkInTime')?.timeOfDay?.hour;
    const co = a.find((x) => x.id === 'checkOutTime')?.timeOfDay?.hour;
    log(`  ${pk}  (checkIn ${ci}:00, checkOut ${co}:00)  "${rec.displayName}"`);
  }

  // 2. Write the policy records.
  log(`\nWriting policies:`);
  for (const [pk, rec] of neededPolicies) await putItem(rec, `${pk} (${rec.displayName})`);

  // 3. Re-point products + 4. regenerate their productDate rows.
  log(`\nRe-pointing ${productTargets.length} AM/PM products and regenerating their productDates:`);
  for (const { product, period, policyPk } of productTargets) {
    const currentPk = product.reservationPolicy?.primaryKey?.pk;
    log(`\n  ${product.displayName}  [${product.pk} sk=${product.sk}]  ${currentPk} → ${policyPk}`);

    const newPolicy = neededPolicies.get(policyPk);

    // 3a. Update the product's policy pointer (preserve the rest of the snapshot).
    const updatedProduct = JSON.parse(JSON.stringify(product));
    updatedProduct.reservationPolicy = {
      ...updatedProduct.reservationPolicy,
      primaryKey: { pk: policyPk, sk: 'v1' },
    };
    updatedProduct.lastUpdated = nowISO();
    await putItem(updatedProduct, `product ${product.sk} → ${policyPk}`);

    // 3b. Regenerate reservationContext on each existing productDate row.
    const pdPk = `productDate::${product.collectionId}::${product.activityType}::${product.activityId}::${product.sk}`;
    let ExclusiveStartKey;
    let count = 0;
    do {
      const res = await ddb.query({
        TableName: TABLE_NAME,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pdPk },
        ExclusiveStartKey,
      }).promise();
      for (const row of (res.Items || [])) {
        const updated = { ...row };
        updated.reservationContext = resolveReservationContext(product, row.date, newPolicy);
        updated.reservationPolicy = newPolicy.productDateRules;
        updated.lastUpdated = nowISO();
        if (!DRY_RUN) await ddb.put({ TableName: TABLE_NAME, Item: updated }).promise();
        count++;
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    log(`    ${DRY_RUN ? '[dry-run] would regenerate' : 'regenerated'} ${count} productDate row(s)`);
  }

  log(`\n${DRY_RUN ? 'DRY RUN complete — no writes performed.' : 'Migration complete.'}`);
}

main().catch((e) => { console.error('Migration failed:', e); process.exit(1); });
