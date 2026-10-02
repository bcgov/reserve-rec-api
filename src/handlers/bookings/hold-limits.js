const { logger } = require("/opt/base");
const { refused } = require("./refusals");

// `releasedBy` on a hold the system released, so it is not counted as removed.
const HOLD_RELEASED_BY_SYSTEM = "system";
const SWITCH_CACHE_MS = 60 * 1000;
const REMOVAL_GRACE_MS = 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

let switchCache = null;
let switchErrorLogged = false;

function positiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Hold limits from the Lambda environment, or null when none are set.
 */
function holdLimitsConfig(env = process.env) {
  const config = {
    removalsBeforeWait: positiveInt(env.HOLD_REMOVALS_BEFORE_WAIT),
    holdsPerHour: positiveInt(env.HOLD_LIMIT_PER_HOUR),
    holdsPerDay: positiveInt(env.HOLD_LIMIT_PER_DAY),
  };
  return Object.values(config).some(Boolean) ? config : null;
}

/**
 * Reads the runtime switch parameter, cached for a minute. Only "false" turns
 * the limits off; a missing or unreadable parameter leaves them on.
 */
async function holdLimitsSwitchOn() {
  const name = process.env.HOLD_LIMITS_ENABLED_PARAMETER;
  if (!name) return true;
  const now = Date.now();
  if (switchCache && now - switchCache.readAt < SWITCH_CACHE_MS) {
    return switchCache.on;
  }
  let on = true;
  try {
    // Required here so the other Lambdas that bundle methods.js never load it.
    const { getParameter } = require("/opt/ssm");
    on = String(await getParameter(name, false)).trim().toLowerCase() !== "false";
  } catch (error) {
    if (!switchErrorLogged) {
      switchErrorLogged = true;
      logger.warn("Hold limits switch unreadable, limits stay on", { parameter: name, error: error?.message });
    }
  }
  switchCache = { on, readAt: now };
  return on;
}

/**
 * The limits in force for this request, or null when off.
 */
async function activeHoldLimits() {
  const config = holdLimitsConfig();
  if (!config) return null;
  return (await holdLimitsSwitchOn()) ? config : null;
}

function isCountingRemoval(booking, now) {
  const cancelledAt = Number(booking?.cancellationTime);
  const expiry = Number(booking?.sessionExpiry);
  if (!booking?.cancellationTime || booking?.bookingCompletionTime) return false;
  if (booking?.releasedBy === HOLD_RELEASED_BY_SYSTEM) return false;
  return expiry > now && cancelledAt < expiry - REMOVAL_GRACE_MS;
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
 * @returns {{removedCount:number, holdsLastHour:number, holdsLastDay:number,
 *   freeRemovalsLeft:number|null, refusal:{code:string, retryAt:number}|null}}
 */
function evaluateHoldLimits(bookings, limits, now) {
  const removalExpiries = bookings.filter((b) => isCountingRemoval(b, now)).map((b) => Number(b.sessionExpiry));
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
  if (limits.holdsPerHour && hourLeaves.length >= limits.holdsPerHour) {
    refusals.push({ code: "HOLD_CAP", retryAt: retryTime(hourLeaves, limits.holdsPerHour) });
  }
  if (limits.holdsPerDay && dayLeaves.length >= limits.holdsPerDay) {
    refusals.push({ code: "HOLD_CAP", retryAt: retryTime(dayLeaves, limits.holdsPerDay) });
  }
  const refusal = refusals.reduce((latest, r) => (!latest || r.retryAt > latest.retryAt ? r : latest), null);

  return {
    removedCount: removalExpiries.length,
    holdsLastHour: hourLeaves.length,
    holdsLastDay: dayLeaves.length,
    freeRemovalsLeft: limits.removalsBeforeWait
      ? Math.max(0, limits.removalsBeforeWait - removalExpiries.length)
      : null,
    refusal,
  };
}

const REFUSAL_MESSAGES = {
  HOLD_COOLDOWN: "You can hold this pass again after a short wait.",
  HOLD_CAP: "You have reached the hold limit for this pass on this date.",
};

/**
 * The 429 refusal for an evaluation that refused. `logFields` carries the
 * outcome line's fields for the handler.
 */
function holdLimitRefusal(evaluation, { userId, productKey, date }) {
  const { code } = evaluation.refusal;
  const retryAt = new Date(evaluation.refusal.retryAt).toISOString();
  const error = refused(code === "HOLD_COOLDOWN" ? "cooldown" : "cap", REFUSAL_MESSAGES[code], 429, { code, retryAt });
  error.logFields = {
    userSub: userId,
    productKey,
    date,
    removedCount: evaluation.removedCount,
    holdsLastHour: evaluation.holdsLastHour,
    holdsLastDay: evaluation.holdsLastDay,
    retryAt,
  };
  return error;
}

// For tests: forget the cached switch value and the logged error.
function _resetHoldLimitsSwitch() {
  switchCache = null;
  switchErrorLogged = false;
}

module.exports = {
  HOLD_HISTORY_MS: DAY_MS,
  HOLD_RELEASED_BY_SYSTEM,
  activeHoldLimits,
  evaluateHoldLimits,
  holdLimitRefusal,
  holdLimitsConfig,
  holdLimitsSwitchOn,
  _resetHoldLimitsSwitch,
};
