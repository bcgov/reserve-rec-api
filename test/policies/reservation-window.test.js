// Day-use passes release two days before the visit at 7am park time
// (bcgov/reserve-rec-public#836). Pins the standard policy's reservationWindow
// to that rule through the real resolver, and mirrors the booking Lambda's
// open-edge comparison (bookings/methods.js validateBookingRequest).
const { DateTime } = require('luxon');
const { resolveTemporalWindow } = require('../../src/common/data-utils');
const policy = require('../../src/handlers/policies/DUP_temp/reservationPolicy1.json');

const TZ = 'America/Vancouver';
const local = (iso) => DateTime.fromISO(iso, { zone: TZ }).toMillis();

function resolveReservationWindow(productDate) {
  const def = policy.productDateRules.temporalWindows.find(
    (w) => w.id === 'reservationWindow' && w.open?.anchorRef === 'productDate'
  );
  return resolveTemporalWindow(def, TZ, { productDate });
}

describe('standard day-use reservation window', () => {
  test('opens 2 days before the product date at 07:00 local and closes at 17:00 on the day', () => {
    const w = resolveReservationWindow('2026-09-18');
    expect(w.open).toBe(local('2026-09-16T07:00:00'));
    expect(w.close).toBe(local('2026-09-18T17:00:00'));
  });

  test('the newly released day is not bookable before 07:00 (#836)', () => {
    const w = resolveReservationWindow('2026-09-18');
    const outside = (queryTime) => w.open > queryTime || w.close < queryTime;
    expect(outside(local('2026-09-16T06:59:59'))).toBe(true);
    expect(outside(local('2026-09-16T07:00:00'))).toBe(false);
  });

  test('a date three days out is still outside the window', () => {
    const w = resolveReservationWindow('2026-09-19');
    expect(w.open > local('2026-09-16T12:00:00')).toBe(true);
  });
});
