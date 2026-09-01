/**
 * Token pool loader. loadtest/tokens.json is an array of
 * { username, sub, accessToken } minted by loadtest/scripts/mint-tokens.js.
 *
 * Tokens are pre-minted because the public user-pool client only allows the
 * SRP auth flow — VUs cannot cheaply authenticate at runtime, and Cognito
 * would become part of the measured system if they tried. Access tokens live
 * 24h, so mint the pool the day of the run.
 */

import { SharedArray } from "k6/data";

const HINT =
  "loadtest/tokens.json is missing or empty. Mint a token pool first:\n" +
  "  USER_POOL_ID=... CLIENT_ID=... COUNT=100 PASSWORD='...' \\\n" +
  "    node loadtest/scripts/mint-tokens.js\n" +
  "then re-run k6 from the repo root.";

export const tokens = new SharedArray("cognito-tokens", function () {
  // open() resolves relative to the module calling it; try repo-root-relative
  // too so `k6 run loadtest/scenarios.js` works from the repo root.
  const candidates = ["../tokens.json", "./tokens.json", "loadtest/tokens.json"];
  let raw = null;
  for (let i = 0; i < candidates.length; i++) {
    try {
      raw = open(candidates[i]);
      break;
    } catch (e) {
      // try next candidate
    }
  }
  if (raw === null) {
    // Search-only rehearsals don't need tokens; authenticated profiles fail
    // fast via assertTokenCount() in setup().
    console.warn(HINT);
    return [];
  }
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) throw new Error("loadtest/tokens.json must be a JSON array");
  return arr;
});

// Map a 1-based DENSE index to a token. Callers must pass an index that is
// dense within the authenticated scenario (see userForIteration() in
// scenarios.js): raw exec.vu.idInTest is only dense for single-scenario
// profiles — under capacity the 14k search-burst VUs scatter the booking
// VUs' ids, which would collide users mod pool size. Distinct users per
// concurrent booking matter because the API's duplicate-booking guard 409s
// a second booking for the same (user, product, startDate) while one is in
// progress or confirmed.
export function tokenForVU(denseId) {
  if (tokens.length === 0) throw new Error(HINT);
  return tokens[(denseId - 1) % tokens.length];
}

export function assertTokenCount(needed, profile) {
  if (tokens.length === 0) throw new Error(HINT);
  if (tokens.length < needed) {
    throw new Error(
      `Profile "${profile}" can run up to ${needed} concurrent VUs but ` +
        `loadtest/tokens.json only has ${tokens.length} users. VUs sharing a ` +
        `user trip the duplicate-booking 409 guard and skew results — mint at ` +
        `least ${needed} users (COUNT=${needed} node loadtest/scripts/mint-tokens.js).`
    );
  }
}
