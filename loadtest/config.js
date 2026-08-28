/**
 * Central configuration for the k6 load-test harness (issue #469).
 * Every knob is env-driven (k6 `-e KEY=value` / --env) with a sane default.
 * This file runs inside k6 (goja, ES2017-ish) — no Node APIs.
 */

function num(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (isNaN(n)) throw new Error(`Env var ${name}="${v}" is not a number`);
  return n;
}

function flag(name, fallback) {
  const v = __ENV[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

function str(name, fallback) {
  return __ENV[name] !== undefined && __ENV[name] !== "" ? __ENV[name] : fallback;
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------
// Always the CloudFront front door. NEVER point BASE_URL at API Gateway
// directly: an origin-verify WAF rule drops any request that lacks the
// CloudFront-injected X-Origin-Verify header, and the CloudFront hop (incl.
// the path-strip function) is deliberately part of the measured path.
export const BASE_URL = str("BASE_URL", "https://test-reserve.bcparks.ca/dayuse/api");

// ---------------------------------------------------------------------------
// Seeded data (src/scripts/tools/dynamodb/seed-collection.js)
// ---------------------------------------------------------------------------
export const SEED = {
  collectionId: str("COLLECTION_ID", "bcparks_7"),
  activityType: str("ACTIVITY_TYPE", "dayuse"),
  activityId: str("ACTIVITY_ID", "1"),
  productId: str("PRODUCT_ID", "1"),
};

// All seeded products are activitySubType vehicleParking, which hard-caps
// quantity at 1 per booking.
export const QUANTITY = num("QUANTITY", 1);

function defaultBookingDate() {
  // Tomorrow (UTC). Must fall inside the product's open reservationWindow.
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
export const BOOKING_DATE = str("BOOKING_DATE", defaultBookingDate());

export const SEARCH_TEXT = str("SEARCH_TEXT", "Joffre");
// Extra terms for browse variety; misses are still valid OpenSearch load.
export const SEARCH_TERMS = str("SEARCH_TERMS", "Joffre,Garibaldi,Golden Ears,Cypress,Strathcona").split(",");

// ---------------------------------------------------------------------------
// Scenario 1 — gated_ramp
// ---------------------------------------------------------------------------
// Booking-chain arrivals per minute, stepped. Each step ramps over STEP_RAMP
// then holds for STEP_HOLD; requests are tagged step:<rate>per_min so results
// can state the last step that stayed within SLO.
export const RAMP_STEPS = str("RAMP_STEPS", "10,25,50,100").split(",").map(Number);
export const STEP_RAMP = str("STEP_RAMP", "1m");
export const STEP_HOLD = str("STEP_HOLD", "5m");
export const RAMP_PREALLOC_VUS = num("RAMP_PREALLOC_VUS", 50);
export const RAMP_MAX_VUS = num("RAMP_MAX_VUS", 300);

// ---------------------------------------------------------------------------
// Scenario 2 — ungated_search_burst
// ---------------------------------------------------------------------------
// 14k concurrent browsers is the ticket's target; override DOWN for
// rehearsals (e.g. -e BURST_VUS=200).
export const BURST_VUS = num("BURST_VUS", 14000);
export const BURST_RAMP = str("BURST_RAMP", "2m");
export const BURST_HOLD = str("BURST_HOLD", "10m");
export const SEARCH_SLEEP_S = num("SEARCH_SLEEP_S", 2); // pacing between searches per VU

// ---------------------------------------------------------------------------
// Scenario 3 — realistic_peak
// ---------------------------------------------------------------------------
export const PEAK_RATE = num("PEAK_RATE", 60); // arrivals per minute at peak
export const PEAK_RAMP = str("PEAK_RAMP", "2m");
export const PEAK_HOLD = str("PEAK_HOLD", "10m");
export const PEAK_PREALLOC_VUS = num("PEAK_PREALLOC_VUS", 50);
export const PEAK_MAX_VUS = num("PEAK_MAX_VUS", 300);
export const BROWSE_RATIO = num("BROWSE_RATIO", 0.7); // fraction of arrivals that only browse
export const ABANDON_RATIO = num("ABANDON_RATIO", 0.4); // fraction of booking starts that never complete

// Simulated checkout "think time" (seconds) between POST /bookings and
// /complete, so checkout_duration reflects realistic form-filling time (AC:
// admission TTL / hold duration must exceed a realistic checkout). Applies
// to every profile that runs the chain. NOTE: longer iterations mean
// arrival-rate executors need proportionally more VUs — size *_MAX_VUS as
// rate x iteration duration.
export const CHECKOUT_THINK_S = num("CHECKOUT_THINK_S", 0);

// ---------------------------------------------------------------------------
// Scenario 4 — contention
// ---------------------------------------------------------------------------
export const CONTENTION_VUS = num("CONTENTION_VUS", 50);
// Seeded capacity of the single targeted product/date. When > 0 a threshold
// asserts bookings_succeeded never exceeds it (oversell guard). Read the real
// capacity from the product-dates response before the run and set this.
export const SEED_INVENTORY = num("SEED_INVENTORY", 0);

// ---------------------------------------------------------------------------
// Scenario 5 — abandonment
// ---------------------------------------------------------------------------
export const ABANDON_RATE = num("ABANDON_RATE", 10); // arrivals per minute
// Booking holds expire after 15 min (DEFAULT_SESSION_LENGTH in
// src/handlers/bookings/methods.js); a full release-verification soak must
// run longer than that.
export const HOLD_MINUTES = num("HOLD_MINUTES", 15);
export const ABANDON_DURATION = str("ABANDON_DURATION", "20m");
export const ABANDON_PREALLOC_VUS = num("ABANDON_PREALLOC_VUS", 20);
export const ABANDON_MAX_VUS = num("ABANDON_MAX_VUS", 100);

// ---------------------------------------------------------------------------
// Scenario 6 — cold_start
// ---------------------------------------------------------------------------
export const COLD_RATE = num("COLD_RATE", 300); // arrivals per minute, from zero
export const COLD_DURATION = str("COLD_DURATION", "5m");
export const COLD_GATE = str("COLD_GATE", "0s"); // startTime offset (idle gate)
export const COLD_PREALLOC_VUS = num("COLD_PREALLOC_VUS", 100);
export const COLD_MAX_VUS = num("COLD_MAX_VUS", 400);

// ---------------------------------------------------------------------------
// Flag-gated endpoints (upstream defects — see README "Upstream blockers")
// ---------------------------------------------------------------------------
// POST /transactions is broken upstream (src/handlers/transactions/methods.js:833
// reads bookingRecord.feeValues.bookingTotal, which no code path writes → 400
// on every call). Keep off until fixed.
export const ENABLE_TRANSACTIONS = flag("ENABLE_TRANSACTIONS", false);
export const TXN_AMOUNT = num("TXN_AMOUNT", 10);
export const WORLDLINE_TOKEN = str("WORLDLINE_TOKEN", "loadtest-token");

// POST /worldline-notification is dead upstream (three defects in
// src/handlers/worldlineNotification/POST/index.js). Keep off until fixed.
export const ENABLE_WEBHOOK = flag("ENABLE_WEBHOOK", false);
export const WEBHOOK_SECRET = str("WEBHOOK_SECRET", "");

// Waiting-room admission flow. Default state in a fresh env is no queue META
// rows, which means enforcement fails open and bookings bypass the queue —
// so this stays off unless a queue has been configured for the target date.
export const WAITING_ROOM = flag("WAITING_ROOM", false);
export const WR_MAX_POLLS = num("WR_MAX_POLLS", 30);
export const WR_POLL_INTERVAL_S = num("WR_POLL_INTERVAL_S", 2);

// ---------------------------------------------------------------------------
// SLO thresholds
// ---------------------------------------------------------------------------
export const P95_MS = num("P95_MS", 3000);
export const MAX_ERROR_RATE = num("MAX_ERROR_RATE", 0.005);

export function buildThresholds(profile) {
  const thresholds = {
    http_req_failed: [`rate<${MAX_ERROR_RATE}`],
    http_req_duration: [`p(95)<${P95_MS}`],
    // The SPA-HTML guard (lib/api.js) must never fire against a correctly
    // configured target.
    html_masquerade_responses: ["count==0"],
  };
  const endpoints = ["search", "product-dates", "bookings", "complete", "cancel"];
  for (const ep of endpoints) {
    thresholds[`http_req_duration{endpoint:${ep}}`] = [`p(95)<${P95_MS}`];
  }
  if (profile === "contention" && SEED_INVENTORY > 0) {
    // Oversell guard: successes must never exceed seeded capacity.
    thresholds["bookings_succeeded"] = [`count<=${SEED_INVENTORY}`];
  }
  return thresholds;
}
