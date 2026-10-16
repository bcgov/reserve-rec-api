const { Exception } = require("/opt/base");

const GENERIC_FAILURE_MESSAGE = "Failed to create booking. Please try again.";

function refused(reason, message, code = 400, data = {}) {
  return new Exception(message, { code, data: { ...data, refusal: reason } });
}

/** A refusal with the generic message. The reason names the log event and is kept off `data`. */
function genericRefusal(reason) {
  const error = new Exception(GENERIC_FAILURE_MESSAGE, { code: 400 });
  error.logRefusal = reason;
  return error;
}

module.exports = { GENERIC_FAILURE_MESSAGE, genericRefusal, refused };
