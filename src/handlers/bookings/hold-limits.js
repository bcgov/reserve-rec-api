const { logger } = require("/opt/base");
const { refused } = require("./refusals");

// `releasedBy` on a hold the system released, so it is not counted as removed.
const HOLD_RELEASED_BY_SYSTEM = "system";
const REMOVAL_GRACE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LIMIT_KEYS = new Set(["removalsBeforeWait", "holdsPerHour", "holdsPerDay", "rebooksBeforeWait", "rebookWaitHours"]);
const DEFAULT_REBOOK_WAIT_HOURS = 24;
const MAX_LIMIT = 500;

let cachedLimits;

/**
 * Parses a HOLD_LIMITS value: an object of LIMIT_KEYS, each an integer from 1
 * to MAX_LIMIT. Returns null when the value is not one.
 */
function parseHoldLimits(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const valid = Object.entries(parsed).every(([key, value]) =>
    LIMIT_KEYS.has(key) && Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT);
  return valid ? parsed : null;
}

/**
 * Hold limits from the Lambda environment, or null when off. A limit absent
 * from HOLD_LIMITS is off; an invalid HOLD_LIMITS turns them all off.
 */
function holdLimitsConfig(env = process.env) {
  if (env.HOLD_LIMITS_ENABLED !== "true") return null;
  const limits = parseHoldLimits(env.HOLD_LIMITS);
  if (!limits) {
    logger.error("event=hold_limits_config_invalid");
    return null;
  }
  return Object.keys(limits).length ? limits : null;
}

/**
 * The limits in force, read once per container.
 */
function activeHoldLimits() {
  if (cachedLimits === undefined) cachedLimits = holdLimitsConfig();
  return cachedLimits;
}

function isCountingRemoval(booking, now) {
  const cancelledAt = Number(booking?.cancellationTime);
  const expiry = Number(booking?.sessionExpiry);
  if (!booking?.cancellationTime || booking?.bookingCompletionTime) return false;
  if (booking?.releasedBy === HOLD_RELEASED_BY_SYSTEM) return false;
  return expiry > now && cancelledAt < expiry - REMOVAL_GRACE_MS;
}

// A booking completed and then cancelled by its owner, counted for the rebook wait.
function isCountingRebook(booking, now, waitMs) {
  const cancelledAt = Number(booking?.cancellationTime);
  if (!booking?.cancellationTime || !booking?.bookingCompletionTime) return false;
  if (booking?.releasedBy === HOLD_RELEASED_BY_SYSTEM) return false;
  return cancelledAt > now - waitMs;
}

function rebookWaitMs(limits) {
  return (limits?.rebookWaitHours ?? DEFAULT_REBOOK_WAIT_HOURS) * HOUR_MS;
}

/**
 * How far back the bookings query must reach for these limits.
 */
function holdHistoryMs(limits) {
  return limits?.rebooksBeforeWait ? Math.max(DAY_MS, rebookWaitMs(limits)) : DAY_MS;
}

// When enough of `leaveTimes` have passed for the count to drop below `limit`.
function retryTime(leaveTimes, limit) {
  const sorted = [...leaveTimes].sort((a, b) => a - b);
  return sorted[sorted.length - limit];
}

/**
 * Applies the limits to the user's bookings for one product and date.
 *
 * @param {Object[]} bookings - every status, from findUserBookingsForProductOnDate
 * @param {Object} limits - from activeHoldLimits
 * @param {number} now - epoch ms
 * @returns {{removedCount:number, rebookCount:number, holdsLastHour:number,
 *   holdsLastDay:number, freeRemovalsLeft:number|null, refusal:{code:string, retryAt:number}|null}}
 */
function evaluateHoldLimits(bookings, limits, now) {
  const removalExpiries = bookings.filter((b) => isCountingRemoval(b, now)).map((b) => Number(b.sessionExpiry));
  const waitMs = rebookWaitMs(limits);
  const rebookLeaves = bookings.filter((b) => isCountingRebook(b, now, waitMs))
    .map((b) => Number(b.cancellationTime) + waitMs);
  const createdWithin = (windowMs) => bookings
    .map((b) => Number(b.sessionInitTime))
    .filter((t) => t > now - windowMs)
    .map((t) => t + windowMs);
  const hourLeaves = createdWithin(HOUR_MS);
  const dayLeaves = createdWithin(DAY_MS);

  const refusals = [];
  if (limits.removalsBeforeWait && removalExpiries.length >= limits.removalsBeforeWait) {
    refusals.push({ code: "HOLD_COOLDOWN", retryAt: retryTime(removalExpiries, limits.removalsBeforeWait) });
  }
  if (limits.rebooksBeforeWait && rebookLeaves.length >= limits.rebooksBeforeWait) {
    refusals.push({ code: "HOLD_REBOOK_WAIT", retryAt: retryTime(rebookLeaves, limits.rebooksBeforeWait) });
  }
  if (limits.holdsPerHour && hourLeaves.length >= limits.holdsPerHour) {
    refusals.push({ code: "HOLD_CAP", retryAt: retryTime(hourLeaves, limits.holdsPerHour) });
  }
  if (limits.holdsPerDay && dayLeaves.length >= limits.holdsPerDay) {
    refusals.push({ code: "HOLD_CAP", retryAt: retryTime(dayLeaves, limits.holdsPerDay) });
  }
  const refusal = refusals.reduce((latest, r) => (!latest || r.retryAt > latest.retryAt ? r : latest), null);

  return {
    removedCount: removalExpiries.length,
    rebookCount: rebookLeaves.length,
    holdsLastHour: hourLeaves.length,
    holdsLastDay: dayLeaves.length,
    freeRemovalsLeft: limits.removalsBeforeWait
      ? Math.max(0, limits.removalsBeforeWait - removalExpiries.length)
      : null,
    refusal,
  };
}

const REFUSAL_REASONS = { HOLD_COOLDOWN: "cooldown", HOLD_CAP: "cap", HOLD_REBOOK_WAIT: "rebook_wait" };

const REFUSAL_MESSAGES = {
  HOLD_COOLDOWN: "You can hold this pass again after a short wait.",
  HOLD_CAP: "You have reached the hold limit for this pass on this date.",
  HOLD_REBOOK_WAIT: "You have cancelled and rebooked this pass several times. You can book it again after a wait.",
};

/**
 * The 429 refusal for an evaluation that refused. `logFields` carries the
 * outcome line's fields for the handler.
 */
function holdLimitRefusal(evaluation, { userId, productKey, date }) {
  const { code } = evaluation.refusal;
  const retryAt = new Date(evaluation.refusal.retryAt).toISOString();
  const error = refused(REFUSAL_REASONS[code], REFUSAL_MESSAGES[code], 429, { code, retryAt });
  error.logFields = {
    userSub: userId,
    productKey,
    date,
    removedCount: evaluation.removedCount,
    rebookCount: evaluation.rebookCount,
    holdsLastHour: evaluation.holdsLastHour,
    holdsLastDay: evaluation.holdsLastDay,
    retryAt,
  };
  return error;
}

// For tests: forget the cached limits.
function _resetHoldLimits() {
  cachedLimits = undefined;
}

module.exports = {
  HOLD_RELEASED_BY_SYSTEM,
  activeHoldLimits,
  evaluateHoldLimits,
  holdHistoryMs,
  holdLimitRefusal,
  holdLimitsConfig,
  _resetHoldLimits,
};
