/**
 * Single k6 entry point for all load-test profiles (issue #469).
 *
 *   k6 run -e PROFILE=capacity    loadtest/scenarios.js   (scenarios 1+2, concurrent)
 *   k6 run -e PROFILE=peak        loadtest/scenarios.js   (scenario 3)
 *   k6 run -e PROFILE=contention  loadtest/scenarios.js   (scenario 4)
 *   k6 run -e PROFILE=abandonment loadtest/scenarios.js   (scenario 5)
 *   k6 run -e PROFILE=coldstart   loadtest/scenarios.js   (scenario 6)
 *
 * See loadtest/README.md for the full runbook. Runs inside k6 (goja) — no
 * Node APIs here.
 */

import exec from "k6/execution";
import { sleep } from "k6";
import * as cfg from "./config.js";
import * as api from "./lib/api.js";
import { tokenForVU, assertTokenCount } from "./lib/data.js";

const PROFILE = __ENV.PROFILE || "capacity";

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

function parseDurationMs(d) {
  const m = String(d).match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!m) throw new Error(`Cannot parse duration "${d}"`);
  const mult = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
  return Number(m[1]) * mult;
}

function rampStages() {
  const stages = [];
  for (const rate of cfg.RAMP_STEPS) {
    stages.push({ target: rate, duration: cfg.STEP_RAMP });
    stages.push({ target: rate, duration: cfg.STEP_HOLD });
  }
  stages.push({ target: 0, duration: "30s" });
  return stages;
}

const gatedRamp = {
  executor: "ramping-arrival-rate",
  exec: "bookingChain",
  startRate: 0,
  timeUnit: "1m",
  preAllocatedVUs: cfg.RAMP_PREALLOC_VUS,
  maxVUs: cfg.RAMP_MAX_VUS,
  stages: rampStages(),
};

const searchBurst = {
  executor: "ramping-vus",
  exec: "searchOnly",
  startVUs: 0,
  stages: [
    { target: cfg.BURST_VUS, duration: cfg.BURST_RAMP },
    { target: cfg.BURST_VUS, duration: cfg.BURST_HOLD },
    { target: 0, duration: "30s" },
  ],
  gracefulRampDown: "10s",
};

const PROFILES = {
  // Scenarios 1 + 2 run concurrently by design: the gated booking ramp is
  // measured while the ungated search burst saturates the read path.
  capacity: {
    gated_ramp: gatedRamp,
    ungated_search_burst: searchBurst,
  },
  peak: {
    realistic_peak: {
      executor: "ramping-arrival-rate",
      exec: "peakIteration",
      startRate: 0,
      timeUnit: "1m",
      preAllocatedVUs: cfg.PEAK_PREALLOC_VUS,
      maxVUs: cfg.PEAK_MAX_VUS,
      stages: [
        { target: cfg.PEAK_RATE, duration: cfg.PEAK_RAMP },
        { target: cfg.PEAK_RATE, duration: cfg.PEAK_HOLD },
        { target: 0, duration: "1m" },
      ],
    },
  },
  contention: {
    // Every VU fires one booking at the SAME product/date at once; the
    // conditional TransactWriteItems oversell guard should admit at most the
    // seeded capacity and reject the rest (counted distinctly in lib/api.js).
    contention: {
      executor: "per-vu-iterations",
      exec: "contentionIteration",
      vus: cfg.CONTENTION_VUS,
      iterations: 1,
      maxDuration: "5m",
    },
  },
  abandonment: {
    abandonment: {
      executor: "constant-arrival-rate",
      exec: "abandonIteration",
      rate: cfg.ABANDON_RATE,
      timeUnit: "1m",
      duration: cfg.ABANDON_DURATION,
      preAllocatedVUs: cfg.ABANDON_PREALLOC_VUS,
      maxVUs: cfg.ABANDON_MAX_VUS,
    },
  },
  coldstart: {
    // Sharp step from zero. Only meaningful against cold Lambdas — see the
    // README for the idle-gate procedure (no warmers, scheduled-opening sim).
    cold_start: {
      executor: "constant-arrival-rate",
      exec: "bookingChain",
      rate: cfg.COLD_RATE,
      timeUnit: "1m",
      duration: cfg.COLD_DURATION,
      startTime: cfg.COLD_GATE,
      preAllocatedVUs: cfg.COLD_PREALLOC_VUS,
      maxVUs: cfg.COLD_MAX_VUS,
    },
  },
};

if (!PROFILES[PROFILE]) {
  throw new Error(`Unknown PROFILE "${PROFILE}". Use one of: ${Object.keys(PROFILES).join("|")}`);
}

export const options = {
  scenarios: PROFILES[PROFILE],
  thresholds: cfg.buildThresholds(PROFILE),
  summaryTrendStats: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],
};

// Max concurrent authenticated VUs per profile — each needs its own user.
const AUTH_VUS_NEEDED = {
  capacity: cfg.RAMP_MAX_VUS,
  peak: cfg.PEAK_MAX_VUS,
  contention: cfg.CONTENTION_VUS,
  abandonment: cfg.ABANDON_MAX_VUS,
  coldstart: cfg.COLD_MAX_VUS,
}[PROFILE];

export function setup() {
  assertTokenCount(AUTH_VUS_NEEDED, PROFILE);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Which ramp step the scenario is currently in, e.g. "50per_min". Applied as
// a `step` tag on every request so results can state the last step that
// stayed within SLO (filter http_req_duration by step in the output).
function currentRampStep() {
  const elapsed = Date.now() - exec.scenario.startTime;
  const rampMs = parseDurationMs(cfg.STEP_RAMP);
  const holdMs = parseDurationMs(cfg.STEP_HOLD);
  let t = 0;
  for (const rate of cfg.RAMP_STEPS) {
    t += rampMs + holdMs;
    if (elapsed < t) return `${rate}per_min`;
  }
  return "rampdown";
}

// Token selection. k6 exposes no per-scenario VU id (only idInTest /
// idInInstance, both shared across scenarios), so:
// - single-scenario profiles: idInTest IS dense (1..maxVUs) — sticky per-VU
//   token, which the abandonment profile's per-VU hold tracking relies on;
// - capacity: gated_ramp shares the id space with the 14k search-burst VUs,
//   so map by the scenario-unique sequential iteration counter instead. All
//   gated_ramp iterations run the same chain, so concurrent iterations
//   differ by < maxVUs <= pool size (enforced in setup()) and never share a
//   user; a rare straggler collision is absorbed by the 409 self-heal path.
function userForIteration() {
  if (exec.scenario.name === "gated_ramp") {
    return tokenForVU(exec.scenario.iterationInTest + 1);
  }
  return tokenForVU(exec.vu.idInTest);
}

function namedOccupant() {
  return {
    firstName: "Load",
    lastName: "Test",
    contactInfo: {
      streetAddress: "123 Test St",
      city: "Victoria",
      province: "BC",
      postalCode: "V8V 1A1",
      country: "CA",
    },
  };
}

function randomSearchTerm() {
  return cfg.SEARCH_TERMS[Math.floor(Math.random() * cfg.SEARCH_TERMS.length)];
}

// Waiting-room admission (only when a queue is configured for the target
// date AND WAITING_ROOM=true; the default env state has no queue rows and
// bookings bypass enforcement entirely). The claim response sets the
// HttpOnly bcparks-admission cookie in the per-VU jar, which then rides
// along on POST /bookings automatically.
function ensureAdmission(user, tags) {
  for (let i = 0; i < cfg.WR_MAX_POLLS; i++) {
    const join = api.waitingRoomJoin(user.accessToken, cfg.SEED, cfg.BOOKING_DATE, tags);
    const d = join.parsed && join.parsed.data;
    if (!d) return false;
    if (d.status === "admitted" || d.status === "admitting") {
      const claim = api.waitingRoomClaim(user.accessToken, d.queueId, tags);
      return claim.response.status >= 200 && claim.response.status < 300;
    }
    sleep(cfg.WR_POLL_INTERVAL_S);
  }
  api.waitingRoomNotAdmitted.add(1);
  return false;
}

// The default measured chain: search → product-dates → book → complete
// (abandonment skips complete). Transactions and the Worldline webhook stay
// flag-gated until the upstream defects are fixed — see README.
function runChain(user, tags) {
  api.search({ text: cfg.SEARCH_TEXT, schema: "facility", size: 25 }, tags);
  api.getProductDates(cfg.SEED, cfg.BOOKING_DATE, tags);

  if (cfg.WAITING_ROOM && !ensureAdmission(user, tags)) return;

  const booking = api.createBooking(user.accessToken, cfg.SEED, cfg.BOOKING_DATE, cfg.QUANTITY, {
    tags: tags,
  });
  const data = booking.parsed && booking.parsed.data;

  if (booking.response.status === 409) {
    // Stale hold from a previous iteration of this VU's user (duplicate
    // guard). Clear it so the next iteration books cleanly.
    if (data && data.existingBookingId) {
      api.cancelBooking(user.accessToken, data.existingBookingId, tags);
    }
    return;
  }
  if (!data || !data.bookingId) return;
  const bookedAt = Date.now();

  if (Math.random() < cfg.ABANDON_RATIO) {
    api.bookingsAbandoned.add(1);
    // Simulated abandonment for load shape only: cancel to release the hold
    // immediately, otherwise this user is 409-blocked for the 15 min hold
    // window. True hold-expiry behaviour is scenario 5's job.
    api.cancelBooking(user.accessToken, data.bookingId, tags);
    return;
  }

  if (cfg.CHECKOUT_THINK_S > 0) sleep(cfg.CHECKOUT_THINK_S);

  const complete = api.completeBooking(
    user.accessToken,
    data.bookingId,
    data.sessionId,
    namedOccupant(),
    tags
  );
  if (complete.response.status >= 200 && complete.response.status < 300) {
    // Booking-success → complete-success elapsed time; the AC requires this
    // to stay under both the admission TTL and the booking hold duration.
    api.checkoutDuration.add(Date.now() - bookedAt, tags);
  }

  if (cfg.ENABLE_TRANSACTIONS) {
    api.createTransaction(
      user.accessToken,
      {
        trnAmount: cfg.TXN_AMOUNT,
        bookingId: data.bookingId,
        token: cfg.WORLDLINE_TOKEN,
        userId: user.sub,
        sessionId: data.sessionId,
      },
      tags
    );
  }
  if (cfg.ENABLE_WEBHOOK) {
    api.worldlineNotification(
      cfg.WEBHOOK_SECRET,
      {
        trnOrderNumber: `LT-${data.bookingId}`,
        ref1: data.bookingId,
        ref2: data.sessionId,
        trnApproved: "1",
        trnAmount: String(cfg.TXN_AMOUNT),
      },
      tags
    );
  }

  // Reset the duplicate-booking guard so this user can book again next
  // iteration (also keeps seeded inventory from draining over a long ramp).
  api.cancelBooking(user.accessToken, data.bookingId, tags);
}

// ---------------------------------------------------------------------------
// Scenario iteration functions
// ---------------------------------------------------------------------------

export function bookingChain() {
  const user = userForIteration();
  const tags = exec.scenario.name === "gated_ramp" ? { step: currentRampStep() } : {};
  runChain(user, tags);
}

export function searchOnly() {
  api.search({ text: randomSearchTerm(), schema: "facility", size: 25 });
  sleep(cfg.SEARCH_SLEEP_S * (0.5 + Math.random()));
}

export function peakIteration() {
  const user = userForIteration();
  if (Math.random() < cfg.BROWSE_RATIO) {
    // Browser: 1–3 searches with think time, then a dates check, no booking.
    const searches = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < searches; i++) {
      api.search({ text: randomSearchTerm(), schema: "facility", size: 25 });
      sleep(1 + Math.random() * 3);
    }
    api.getProductDates(cfg.SEED, cfg.BOOKING_DATE);
    return;
  }
  runChain(user, {});
}

export function contentionIteration() {
  const user = userForIteration();
  // One shot per VU, all at the same product/date. No cancel afterwards —
  // successes must stay held so bookings_succeeded can be compared against
  // seeded capacity (SEED_INVENTORY threshold).
  api.createBooking(user.accessToken, cfg.SEED, cfg.BOOKING_DATE, cfg.QUANTITY, {
    expectContention: true,
  });
}

// Per-VU flag: this user abandoned a hold and has not rebooked since.
let abandonedHold = false;

export function abandonIteration() {
  const user = userForIteration();
  const booking = api.createBooking(user.accessToken, cfg.SEED, cfg.BOOKING_DATE, cfg.QUANTITY, {});
  const data = booking.parsed && booking.parsed.data;

  if (booking.response.status === 409) {
    // Expected while this user's abandoned hold is still alive (15 min);
    // deliberately NOT cancelled — expiry + the reaper must release it.
    return;
  }
  if (!data || !data.bookingId) return;

  if (abandonedHold) {
    // A fresh success after a prior abandonment proves the released
    // inventory became bookable again.
    api.rebookAfterRelease.add(1);
    abandonedHold = false;
  }

  if (Math.random() < cfg.ABANDON_RATIO) {
    api.bookingsAbandoned.add(1);
    abandonedHold = true;
    return; // hold left to expire
  }

  api.completeBooking(user.accessToken, data.bookingId, data.sessionId, namedOccupant());
  api.cancelBooking(user.accessToken, data.bookingId);
}
