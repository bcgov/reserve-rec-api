const { DateTime } = require("luxon");
const { refused } = require("./refusals");

// Queue, hold and duplicate keys are built from these raw strings, and product dates are
// fetched by string range, so only a real calendar date in canonical form may pass.
function isCalendarDate(value) {
  return typeof value === "string" && DateTime.fromFormat(value, "yyyy-MM-dd").toISODate() === value;
}

function validateBookingDates(startDate, endDate) {
  if (!isCalendarDate(startDate) || (endDate != null && !isCalendarDate(endDate))) {
    throw refused("invalid", "startDate and endDate must be real dates in yyyy-MM-dd format");
  }
  if (endDate != null && endDate < startDate) {
    throw refused("invalid", "endDate cannot be before startDate");
  }
}

module.exports = { validateBookingDates };
