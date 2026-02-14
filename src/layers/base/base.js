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
      "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT",
    "Access-Control-Allow-Credentials": true
  };
  
  // If other fields are present, add them to body
  if (other) {
    body = Object.assign(body, other);
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

/**
 * Handle CORS preflight requests
 * @param {Object} event - Lambda event
 * @param {Object} context - Lambda context
 * @returns {Object|null} - Response object if OPTIONS request, null otherwise
 */
const handleCORS = function (event, context) {
  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, {}, "Success", null, context);
  }
  return null;
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

function getRequestClaimsFromEvent(event) {
  try {
    // Check Authorization header for JWT token
    const authHeader = event.headers?.Authorization || event.headers?.authorization;
    if (authHeader) {
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

    // First check if this is an authenticated request via authorizer context
    const authContext = event.requestContext?.authorizer;
    
    if (authContext) {
      // Check if user is authenticated (new public authorizer format)
      const isAuthenticated = authContext.isAuthenticated === 'true' || authContext.isAuthenticated === true;
      
      if (!isAuthenticated) {
        // Unauthenticated user - no guest access allowed for bookings
        logger.info('Unauthenticated user detected from authorizer context - no claims available');
        return null;
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

    // No authentication found
    logger.info('No authentication found - no claims available');
    return null;
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

/**
 * Validation patterns for common fields
 */
const VALIDATION_PATTERNS = {
  BOOKING_ID: /^[a-zA-Z0-9-_]{8,100}$/,
  QR_HASH: /^[a-f0-9]{16}$/i
};

/**
 * Calculate total party size from party information object
 * @param {Object} partyInformation - Party information with adult, senior, youth, child counts
 * @returns {number} Total party size
 */
const calculatePartySize = function(partyInformation) {
  if (!partyInformation) return 0;
  return (partyInformation.adult || 0) + 
         (partyInformation.senior || 0) +
         (partyInformation.youth || 0) +
         (partyInformation.child || 0);
};

/**
 * Write audit log entry for operations requiring security audit trail
 * @param {string} user - User ID performing the operation
 * @param {string} entityId - Entity ID being operated on (e.g., bookingId)
 * @param {string} operation - Operation type (e.g., 'QR_VERIFY_SUCCESS', 'QR_VERIFY_FAILED')
 * @param {object} metadata - Additional metadata about the operation
 * @param {Function} marshallFn - Marshall function from dynamodb layer
 * @param {Function} batchWriteFn - Batch write function from dynamodb layer
 * @param {string} auditTableName - Name of the audit table
 */
async function writeAuditLog(user, entityId, operation, metadata = {}, marshallFn, batchWriteFn, auditTableName) {
  try {
    const timestamp = new Date().toISOString();
    
    const auditRecord = {
      pk: marshallFn(user),
      sk: marshallFn(timestamp),
      gsipk: marshallFn(`entity::${entityId}`),
      gsisk: marshallFn(timestamp),
      operation: marshallFn(operation),
      metadata: marshallFn({
        entityId,
        ...metadata,
        timestamp
      })
    };
    
    await batchWriteFn([auditRecord], 25, auditTableName);
    logger.debug('Audit log written', { user, entityId, operation });
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to write audit log', { error: error.message, user, entityId, operation });
  }
}

/**
 * Validate SuperAdmin authorization from event claims
 * @param {Object} event - Lambda event
 * @param {string} [operationContext] - Optional context string for logging (e.g., 'QR verification')
 * @returns {Object} Claims object if authorized
 * @throws {Exception} If user is not a SuperAdmin
 */
function validateSuperAdminAuth(event, operationContext = 'operation') {
  // Extract claims from authorizer context
  const claims = event.requestContext?.authorizer?.claims || getRequestClaimsFromEvent(event);
  
  if (!claims) {
    logger.warn('No authorization claims found in request');
    throw new Exception("Unauthorized - Authentication required", { code: 401 });
  }
  
  // Check if user is a SuperAdmin
  const cognitoGroups = claims['cognito:groups'] || [];
  const isSuperAdmin = cognitoGroups.some(group => 
    group.includes('SuperAdminGroup')
  );

  if (!isSuperAdmin) {
    logger.warn(`Unauthorized ${operationContext} attempt by user ${claims.sub}`);
    throw new Exception("Forbidden - SuperAdmin access required", { code: 403 });
  }

  logger.info(`SuperAdmin ${operationContext} access granted for user ${claims.sub}`);
  return claims;
}

module.exports = {
  DateTime,
  Exception,
  buildDateTimeFromShortDate,
  buildDateRange,
  calculatePartySize,
  checkWarmup,
  handleCORS,
  getNow,
  getNowISO,
  getRequestClaimsFromEvent,
  logger,
  sendMessage,
  sendResponse,
  httpGet,
  VALIDATION_PATTERNS,
  validateSuperAdminAuth,
  writeAuditLog
};
