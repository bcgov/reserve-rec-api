const axios = require('axios');
const { ApiGatewayManagementApi } = require('@aws-sdk/client-apigatewaymanagementapi');
const { DateTime } = require('luxon');
const { createLogger, format, transports } = require("winston");
const { combine, timestamp } = format;

const DEFAULT_TIMEZONE = 'America/Vancouver';

const LEVEL = process.env.LOG_LEVEL || "error";

const logger = createLogger({
  level: LEVEL,
  format: combine(
    timestamp(),
    format.printf((info) => {
      let meta = "";
      let symbols = Object.getOwnPropertySymbols(info);
      if (symbols.length == 2) {
        meta = JSON.stringify(info[symbols[1]]);
      }
      return `${info.timestamp} ${[info.level.toUpperCase()]}: ${info.message
        } ${meta}`;
    })
  ),
  transports: [new transports.Console()],
});

/**
 * Constructs a response object with the provided parameters.
 * @param {number} code - The HTTP status code of the response.
 * @param {*} data - The data payload of the response.
 * @param {string} message - The message associated with the response.
 * @param {string|null} error - The error message, if any, associated with the response.
 * @param {*} context - Additional context or metadata related to the response.
 * @param {*} [other=null] - Additional fields to include in the response body.
 * @returns {object} - The constructed response object.
 */
const sendResponse = function (code, data, message, error, context, other = null) {
  // All responses must include the following fields as a minimum.
  let body = {
    code: code,
    data: data,
    msg: message,
    error: error,
    context: context
  };
  // If other fields are present, attach them to the body.
  if (other) {
    body = Object.assign(body, other);
  }
  const response = {
    statusCode: code,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT",
    },
    body: JSON.stringify(body),
  };
  return response;
};

const checkWarmup = function (event) {
  if (event?.warmup === true) {
    return true;
  } else {
    return false;
  }
};

const getNowISO = function (tz = null) {
  return getNow(tz).toISO();
};


const getNow = function (tz = null) {
  if (!tz) {
    tz = 'UTC'
  }
  return DateTime.now().setZone(tz);
};

async function httpGet(url, params = null, headers = null) {
  try {
    let request = {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'None',
        'Accept': 'application/json',
      }
    };
    if (params) {
      request.params = params;
    }
    if (headers) {
      request.headers = { ...headers, ...request.headers };
    }
    return await axios.get(encodeURI(url), request);
  } catch (error) {
    logger.debug('Error getting data register records: getDataRegisterRecords function in dataRegister layer');
    throw error;
  }
}

const buildDateTimeFromShortDate = function (shortDate, tz = DEFAULT_TIMEZONE) {
  return DateTime.fromFormat(shortDate, 'yyyy-LL-dd', { zone: tz });
}

const buildDateRange = function (startDate, endDate, format = 'yyyy-LL-dd') {
  let dateRange = [];
  // convert startDate and endDate to DateTime objects
  const startDateTime = DateTime.fromISO(startDate);
  const endDateTime = DateTime.fromISO(endDate);
  let currentDate = startDateTime;
  while (currentDate <= endDateTime) {
    dateRange.push(currentDate.toFormat(format));
    currentDate = currentDate.plus({ days: 1 });
  }
  return dateRange;
}

async function sendMessage(targetConnectionId, domainName, stage, message) {
  const apigatewaymanagementapi = new ApiGatewayManagementApi({
    endpoint: `${domainName}/${stage}`
  });

  const params = {
    ConnectionId: targetConnectionId,
    Data: JSON.stringify({ message })
  };

  try {
    await apigatewaymanagementapi.postToConnection(params).promise();
    console.log(`Message sent to connectionId: ${targetConnectionId}`);
  } catch (error) {
    console.error(`Failed to send message to connectionId: ${targetConnectionId}`, error);
  }
}

const Exception = class extends Error {
  constructor(message, errorData) {
    super(message);
    this.code = errorData?.code || null;
    this.error = errorData?.error || null;
    this.msg = message || null;
    this.data = errorData?.data || null;
  }
};

module.exports = {
  DateTime,
  Exception,
  buildDateTimeFromShortDate,
  buildDateRange,
  checkWarmup,
  getNow,
  getNowISO,
  logger,
  sendMessage,
  sendResponse,
  httpGet
}
