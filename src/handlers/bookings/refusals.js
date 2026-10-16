const { Exception } = require("/opt/base");

// The public site's own fallback text for a failed hold.
const GENERIC_FAILURE_MESSAGE = "Failed to create booking. Please try again.";

function refused(reason, message, code = 400, data = {}) {
  return new Exception(message, { code, data: { ...data, refusal: reason } });
}

/**
 * A refusal answered exactly as an unexpected failure. The reason names the
 * log event only and is kept off `data`, which the handlers return.
 */
function genericRefusal(reason) {
  const error = new Exception(GENERIC_FAILURE_MESSAGE, { code: 400 });
  error.logRefusal = reason;
  return error;
}

module.exports = { GENERIC_FAILURE_MESSAGE, genericRefusal, refused };
