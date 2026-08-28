/**
 * Thin API client for the reserve-rec public API — one function per endpoint,
 * each returning { response, parsed }.
 *
 * Every response passes through guard(), which detects the
 * SPA-HTML-masquerading-as-200 failure mode: the standalone public
 * distribution rewrites 403/404 to a 200 index.html, so a misconfigured
 * BASE_URL can produce "successful" runs that never touched the API. The
 * front door does not rewrite, but the guard protects against pointing the
 * harness at the wrong target.
 */

import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import { BASE_URL } from "../config.js";

export const htmlMasquerade = new Counter("html_masquerade_responses");
export const bookingsSucceeded = new Counter("bookings_succeeded");
export const bookingsCompleted = new Counter("bookings_completed");
export const bookingsAbandoned = new Counter("bookings_abandoned");
export const duplicateConflicts = new Counter("booking_duplicate_409");
// Distinct conditional-write failure modes under contention (AC: measure
// oversell-guard behaviour). Both surface as 400 with
// error.cancellationReasons from the TransactWriteItems call.
export const soldOutRejections = new Counter("inventory_conditional_check_failed");
export const transactionConflicts = new Counter("inventory_transaction_conflict");
export const rebookAfterRelease = new Counter("rebook_after_release");
// Elapsed ms from a successful POST /bookings to a successful /complete —
// compare max/p99 against the admission TTL and booking hold duration (see
// README "Checkout duration vs the TTLs").
export const checkoutDuration = new Trend("checkout_duration", true);
export const waitingRoomNotAdmitted = new Counter("waiting_room_not_admitted");

const JSON_HEADERS = { "Content-Type": "application/json" };

function guard(res, endpoint) {
  const ct = res.headers["Content-Type"] || res.headers["content-type"] || "";
  const body = typeof res.body === "string" ? res.body : "";
  const looksHtml = ct.indexOf("text/html") !== -1 || /^\s*<(!doctype|html)/i.test(body);
  check(res, { "response is not SPA HTML": (r) => !looksHtml }, { endpoint: endpoint });
  if (looksHtml) {
    htmlMasquerade.add(1, { endpoint: endpoint });
    return null;
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch (e) {
    return null;
  }
}

function tags(endpoint, extra) {
  return Object.assign({ endpoint: endpoint }, extra || {});
}

function authHeaders(accessToken) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
}

function toQuery(params) {
  return Object.keys(params)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join("&");
}

// POST /search — no auth. `text` is free text, other fields become term filters.
export function search(body, extraTags) {
  const res = http.post(`${BASE_URL}/search`, JSON.stringify(body), {
    headers: JSON_HEADERS,
    tags: tags("search", extraTags),
  });
  return { response: res, parsed: guard(res, "search") };
}

// GET /product-dates/{collectionId}/{activityType}/{activityId}/{productId}?date=
// A bookable productDate has reservationContext.isReservable === true.
export function getProductDates(seed, date, extraTags) {
  const url =
    `${BASE_URL}/product-dates/${seed.collectionId}/${seed.activityType}` +
    `/${seed.activityId}/${seed.productId}?date=${date}`;
  const res = http.get(url, { tags: tags("product-dates", extraTags) });
  return { response: res, parsed: guard(res, "product-dates") };
}

// POST /bookings — auth required (Cognito ACCESS token; ID tokens 401).
// The SPA sends the required params in both query string and body; mirror it.
// Identity fields are overwritten server-side from Cognito, so none are sent.
export function createBooking(accessToken, seed, startDate, quantity, opts) {
  opts = opts || {};
  const params = {
    collectionId: seed.collectionId,
    activityType: seed.activityType,
    activityId: seed.activityId,
    productId: seed.productId,
    startDate: startDate,
    quantity: quantity,
  };
  // 409 (duplicate-booking guard) is an expected outcome the chain handles;
  // under contention 400 (conditional-write rejection) is the outcome being
  // measured — neither should pollute http_req_failed.
  const expected = opts.expectContention
    ? http.expectedStatuses({ min: 200, max: 299 }, 400, 409)
    : http.expectedStatuses({ min: 200, max: 299 }, 409);
  const res = http.post(`${BASE_URL}/bookings?${toQuery(params)}`, JSON.stringify(params), {
    headers: authHeaders(accessToken),
    tags: tags("bookings", opts.tags),
    responseCallback: expected,
  });
  const parsed = guard(res, "bookings");
  if (res.status >= 200 && res.status < 300 && parsed && parsed.data && parsed.data.bookingId) {
    bookingsSucceeded.add(1);
  } else if (res.status === 409) {
    duplicateConflicts.add(1);
  } else if (res.status === 400 && parsed) {
    const raw = JSON.stringify(parsed);
    if (raw.indexOf("ConditionalCheckFailed") !== -1) {
      soldOutRejections.add(1);
    } else if (raw.indexOf("TransactionConflict") !== -1) {
      transactionConflicts.add(1);
    }
  }
  return { response: res, parsed: parsed };
}

// POST /bookings/{bookingId}/complete — auth required. Body must carry the
// sessionId returned by the create call (403 on mismatch/expiry) and a
// namedOccupant with the mandatory contactInfo fields.
export function completeBooking(accessToken, bookingId, sessionId, namedOccupant, extraTags) {
  const body = {
    sessionId: sessionId,
    namedOccupant: namedOccupant,
    vehicleInformation: [{ licensePlate: "LOADTST", licensePlateRegistrationRegion: "BC" }],
    smsOptIn: false,
  };
  const res = http.post(`${BASE_URL}/bookings/${bookingId}/complete`, JSON.stringify(body), {
    headers: authHeaders(accessToken),
    tags: tags("complete", extraTags),
  });
  const parsed = guard(res, "complete");
  if (res.status >= 200 && res.status < 300) bookingsCompleted.add(1);
  return { response: res, parsed: parsed };
}

// POST /bookings/{bookingId}/cancel — auth required. Works on both
// 'in progress' and 'confirmed' bookings; used to reset the duplicate-booking
// guard between iterations and as teardown.
export function cancelBooking(accessToken, bookingId, extraTags) {
  const res = http.post(
    `${BASE_URL}/bookings/${bookingId}/cancel`,
    JSON.stringify({ reason: "load test cleanup" }),
    {
      headers: authHeaders(accessToken),
      tags: tags("cancel", extraTags),
      // Racing the expiry scraper can produce an already-cancelled 400.
      responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 400),
    }
  );
  return { response: res, parsed: guard(res, "cancel") };
}

// POST /transactions — bookingId goes in the BODY, not the path. userId must
// equal the access token's sub. KNOWN-BROKEN upstream (see README): gated
// behind ENABLE_TRANSACTIONS at the call site.
export function createTransaction(accessToken, body, extraTags) {
  const res = http.post(`${BASE_URL}/transactions`, JSON.stringify(body), {
    headers: authHeaders(accessToken),
    tags: tags("transactions", extraTags),
  });
  return { response: res, parsed: guard(res, "transactions") };
}

// POST /worldline-notification?webhookSecret= — form-encoded body, no auth
// beyond the query secret. KNOWN-DEAD upstream (see README): gated behind
// ENABLE_WEBHOOK at the call site.
export function worldlineNotification(webhookSecret, form, extraTags) {
  // k6 form-encodes automatically when the body is an object.
  const res = http.post(
    `${BASE_URL}/worldline-notification?webhookSecret=${encodeURIComponent(webhookSecret)}`,
    form,
    { tags: tags("worldline-notification", extraTags) }
  );
  return { response: res, parsed: guard(res, "worldline-notification") };
}

// POST /waiting-room/join — auth required. Idempotent per (user, queue).
export function waitingRoomJoin(accessToken, seed, startDate, extraTags) {
  const body = {
    collectionId: seed.collectionId,
    activityType: seed.activityType,
    activityId: seed.activityId,
    startDate: startDate,
  };
  const res = http.post(`${BASE_URL}/waiting-room/join`, JSON.stringify(body), {
    headers: authHeaders(accessToken),
    tags: tags("waiting-room-join", extraTags),
  });
  return { response: res, parsed: guard(res, "waiting-room-join") };
}

// POST /waiting-room/claim — delivers the HttpOnly bcparks-admission cookie;
// the per-VU cookie jar carries it onto the subsequent booking call.
export function waitingRoomClaim(accessToken, queueId, extraTags) {
  const res = http.post(`${BASE_URL}/waiting-room/claim`, JSON.stringify({ queueId: queueId }), {
    headers: authHeaders(accessToken),
    tags: tags("waiting-room-claim", extraTags),
    responseCallback: http.expectedStatuses({ min: 200, max: 299 }, 403),
  });
  return { response: res, parsed: guard(res, "waiting-room-claim") };
}
