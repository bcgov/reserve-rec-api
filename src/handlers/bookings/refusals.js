const { Exception } = require("/opt/base");

function refused(reason, message, code = 400, data = {}) {
  return new Exception(message, { code, data: { ...data, refusal: reason } });
}

module.exports = { refused };
