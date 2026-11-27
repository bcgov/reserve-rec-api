'use strict';

const MIN_IP_SPACING = 5;

/**
 * Fisher-Yates shuffle — mutates the array in place.
 */
function fisherYates(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * IP-aware spread: swaps clustered same-IP entries with a random entry outside the
 * spacing window so they end up at least MIN_IP_SPACING apart.
 *
 * @param {object[]} arr - Shuffled entries (each has a clientIp field)
 * @returns {object[]} Same array, mutated
 */
function applyIpSpread(arr) {
  // Budget caps total swaps to prevent pathological looping on IP-heavy inputs.
  // In practice each entry needs at most a few swaps; arr.length is generous.
  let swapBudget = arr.length;

  for (let i = 0; i < arr.length; i++) {
    const ip = arr[i].clientIp;
    if (!ip || ip === 'unknown') continue;

    // Check whether this entry violates spacing with a previous same-IP entry
    let violated = false;
    for (let j = Math.max(0, i - MIN_IP_SPACING); j < i; j++) {
      if (arr[j].clientIp === ip) { violated = true; break; }
    }
    if (!violated) continue;

    // Too close — find candidates beyond the forward window whose own IP
    // also won't cluster at position i (fix: validate destination for candidate).
    const candidates = [];
    for (let k = i + MIN_IP_SPACING; k < arr.length; k++) {
      if (arr[k].clientIp === ip) continue;
      const cIp = arr[k].clientIp;
      if (cIp && cIp !== 'unknown') {
        let cViolates = false;
        const winStart = Math.max(0, i - MIN_IP_SPACING);
        const winEnd = Math.min(arr.length - 1, i + MIN_IP_SPACING);
        for (let m = winStart; m <= winEnd; m++) {
          if (m === i) continue;
          if (arr[m].clientIp === cIp) { cViolates = true; break; }
        }
        if (cViolates) continue;
      }
      candidates.push(k);
    }

    if (candidates.length > 0 && swapBudget > 0) {
      const swapIdx = candidates[Math.floor(Math.random() * candidates.length)];
      [arr[i], arr[swapIdx]] = [arr[swapIdx], arr[i]];
      swapBudget--;
      i--; // Re-examine the newly placed element at position i
    }
    // No valid candidate or budget exhausted — leave in place (best effort)
  }
  return arr;
}

/**
 * Returns a shuffled copy of entries with same-IP entries spread apart.
 * The input array is not modified.
 */
function shuffleWithIpSpread(entries) {
  return applyIpSpread(fisherYates([...entries]));
}

module.exports = { shuffleWithIpSpread, applyIpSpread };
