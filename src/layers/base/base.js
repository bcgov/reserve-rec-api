const axios = require('axios');
const crypto = require("crypto");
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
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
      // Normalize the message
      let msg = '';
      if (typeof info.message === "string") {
        msg = info.message;
      } else {
        try {
          msg = JSON.stringify(info.message);
        } catch {
          msg = String(info.message);
        }
      }

      // Handle metadata
      const { level, message, timestamp, ...rest } = info;
      let restStr = '';
      try {
        restStr = JSON.stringify(rest)
      } catch {
        restStr = String(rest)
      }
      let meta = Object.keys(rest).length > 0 ? restStr : "";

      return `${info.timestamp} [${info.level.toUpperCase()}]: ${msg}${meta ? " " + meta : ""}`;
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
  
  // Prepare headers
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers":
      "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,x-guest-sub",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT",
    "Access-Control-Allow-Credentials": true,
    "Access-Control-Expose-Headers": "x-guest-sub"
  };
  
  // If other fields are present, process them
  if (other) {
    // Extract guestSub if present and add to headers
    if (other.guestSub) {
      headers['x-guest-sub'] = other.guestSub;
      // Remove guestSub from other so it doesn't get added to body
      const { guestSub, ...remainingOther } = other;
      if (Object.keys(remainingOther).length > 0) {
        body = Object.assign(body, remainingOther);
      }
    } else {
      // No guestSub, just add all fields to body
      body = Object.assign(body, other);
    }
  }
  
  const response = {
    statusCode: code,
    headers: headers,
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
    tz = 'UTC';
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
};

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
};

/**
 * Sends a message to a specified WebSocket connection using AWS API Gateway.
 *
 * @param {string} targetConnectionId - The ID of the target WebSocket connection.
 * @param {string} domainName - The domain name of the API Gateway endpoint.
 * @param {string} stage - The stage of the API Gateway endpoint.
 * @param {string} message - The message to be sent to the target connection.
 * @returns {Promise<void>} - A promise that resolves when the message is sent.
 * @throws {Error} - Throws an error if the message fails to send.
 */
async function sendMessage(targetConnectionId, domainName, stage, message) {
  const client = new ApiGatewayManagementApiClient({
    endpoint: `${domainName}/${stage}`
  });

  const params = {
    ConnectionId: targetConnectionId,
    Data: JSON.stringify({ message })
  };

  try {
    logger.debug("params:", params);
    const command = new PostToConnectionCommand(params);
    const response = await client.send(command);
    logger.debug("response:", response);
    logger.info(`Message sent to connectionId: ${targetConnectionId}`);
  } catch (error) {
    console.error(`Failed to send message to connectionId: ${targetConnectionId}`, error);
  }
}

// function getRequestClaimsFromEvent(event) {
//   try {
//     return event.requestContext.authorizer.claims;
//   } catch (error) {
//     throw new Error(`Unable to retrieve request claims from event: ${error.message}`);
//   }
// }

function getRequestClaimsFromEvent(event) {
  try {
    // First check if this is an authenticated request via authorizer context
    const authContext = event.requestContext?.authorizer;
    
    if (authContext) {
      // Check if user is authenticated (new public authorizer format)
      const isAuthenticated = authContext.isAuthenticated === 'true' || authContext.isAuthenticated === true;
      
      if (!isAuthenticated) {
        // Guest user - check if we already have a guest UUID, otherwise generate one
        logger.info('guest user detected from authorizer context');
        
        // Check Authorization header for existing guest UUID
        const authHeader = event.headers?.Authorization || event.headers?.authorization;
        if (authHeader && authHeader.startsWith('Guest ')) {
          const guestSub = authHeader.substring(6).trim();
          if (guestSub && guestSub.startsWith('guest-')) {
            logger.info('Reusing guest sub from Authorization header:', guestSub);
            return { sub: guestSub };
          }
        }
        
        // Check x-guest-sub header
        const existingGuestSub = event.headers?.['x-guest-sub'] || event.headers?.['X-Guest-Sub'];
        if (existingGuestSub && existingGuestSub.startsWith('guest-')) {
          logger.info('Reusing existing guest sub from x-guest-sub header:', existingGuestSub);
          return { sub: existingGuestSub };
        }
        
        // Generate new guest identifier
        logger.info('Generating new guest user identifier');
        const uuid = crypto.randomUUID();
        return { sub: `guest-${uuid}` };
      }
      
      // Authenticated user - return claims from context or claims object
      if (authContext.claims) {
        return authContext.claims;
      }
      
      // New context format - construct claims object from individual fields
      if (authContext.userId && authContext.userId !== 'guest') {
        return {
          sub: authContext.userId,
          email: authContext.email || '',
          username: authContext.username || '',
          'cognito:username': authContext.username || '',
          userType: authContext.userType || 'authenticated'
        };
      }
    }

    // Check Authorization header for guest or JWT token
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (authHeader) {
      // Check for Guest authorization format: "Guest guest-{uuid}"
      if (authHeader.startsWith('Guest ')) {
        const guestSub = authHeader.substring(6).trim(); // Remove "Guest " prefix
        if (guestSub && guestSub.startsWith('guest-')) {
          logger.info('Reusing guest sub from Authorization header:', guestSub);
          return { sub: guestSub };
        }
      }
      
      // Try to decode as JWT (Bearer token for authenticated users)
      const token = authHeader.replace('Bearer ', '');
      try {
        // JWT format: header.payload.signature
        const payloadBase64 = token.split('.')[1];
        if (payloadBase64) {
          const payloadJson = Buffer.from(payloadBase64, 'base64').toString('utf-8');
          const payload = JSON.parse(payloadJson);
          logger.info('Decoded JWT claims from Authorization header:', payload.sub);
          return payload;
        }
      } catch (jwtError) {
        logger.error('Failed to decode JWT from Authorization header:', jwtError);
      }
    }

    // Check if guest sub is provided in x-guest-sub header (alternative method)
    const existingGuestSub = event.headers?.['x-guest-sub'] || event.headers?.['X-Guest-Sub'];
    if (existingGuestSub && existingGuestSub.startsWith('guest-')) {
      logger.info('Reusing existing guest sub from x-guest-sub header:', existingGuestSub);
      return { sub: existingGuestSub };
    }

    // No authentication found - generate new guest identifier
    logger.info('No authentication found - generating new guest user identifier');
    const uuid = crypto.randomUUID();
    return { sub: `guest-${uuid}` };
  } catch (error) {
    logger.error(`Error retrieving request claims: ${error.message}`);
    return null;
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
  getRequestClaimsFromEvent,
  logger,
  sendMessage,
  sendResponse,
  httpGet
};
