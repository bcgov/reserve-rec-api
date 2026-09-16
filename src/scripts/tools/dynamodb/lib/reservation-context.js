/**
 * Shared helpers for policy migrations that must re-bake the reservationContext
 * stored on productDate rows. productDates snapshot the resolved window millis
 * at creation time (productDates/methods.js resolveProductDateReservationContext),
 * so editing a policy record changes nothing until its rows are regenerated.
 */

'use strict';

const path = require('path');

// Reuse the REAL temporal resolver (pure luxon math) by shimming the Lambda
// layer paths it imports. base.js gives exact epoch math (no drift); the
// resolver never calls the dynamodb layer, so that one is stubbed.
const Module = require('module');
const origLoad = Module._load;
const BASE_PATH = path.resolve(__dirname, '../../../../layers/base/base.js');
Module._load = function (request, ...rest) {
  if (request === '/opt/base') return origLoad.call(this, BASE_PATH, ...rest);
  if (request === '/opt/dynamodb') {
    return { getOne: async () => null, marshall: (x) => x, runQuery: async () => ({ items: [] }), batchGetData: async () => [], REFERENCE_DATA_TABLE_NAME: process.env.TABLE_NAME };
  }
  return origLoad.call(this, request, ...rest);
};
const { resolveTemporalAnchor, resolveTemporalWindow } = require(path.resolve(__dirname, '../../../../common/data-utils.js'));

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

function productDatePk(product) {
  return `productDate::${product.collectionId}::${product.activityType}::${product.activityId}::${product.sk}`;
}

/**
 * Re-resolves reservationContext on a product's productDate rows against `policy`.
 * `fromDate` (YYYY-MM-DD) limits the rewrite to that date onward; omit for all rows.
 * Returns the number of rows touched (or that would be, in dry-run).
 */
async function regenerateProductDates(ddb, tableName, product, policy, { dryRun = false, fromDate = null } = {}) {
  const query = {
    TableName: tableName,
    KeyConditionExpression: fromDate ? 'pk = :pk AND sk >= :from' : 'pk = :pk',
    ExpressionAttributeValues: fromDate ? { ':pk': productDatePk(product), ':from': fromDate } : { ':pk': productDatePk(product) },
  };
  let ExclusiveStartKey;
  let count = 0;
  do {
    const res = await ddb.query({ ...query, ExclusiveStartKey }).promise();
    for (const row of (res.Items || [])) {
      const updated = { ...row };
      updated.reservationContext = resolveReservationContext(product, row.date, policy);
      updated.reservationPolicy = policy.productDateRules;
      updated.lastUpdated = new Date().toISOString();
      if (!dryRun) await ddb.put({ TableName: tableName, Item: updated }).promise();
      count++;
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return count;
}

module.exports = { resolveReservationContext, regenerateProductDates };
