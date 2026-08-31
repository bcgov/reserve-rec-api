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
 * Coerces a status code into something API Gateway will accept.
 *
 * A Lambda proxy response carrying a statusCode outside 100-599 is rejected by API
 * Gateway, which then returns its own opaque 502 -- so an out-of-range code silently
 * replaces the handler's intended error with a far less useful one.
 */
const normalizeStatusCode = function (code) {
  const parsed = Number(code);
  if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) {
    return parsed;
  }
  return 500;
};

/**
 * JSON.stringify that cannot throw.
 *
 * Handlers pass raw caught errors straight into the response body. AWS SDK errors hold a
 * circular `IncomingMessage -> req -> res` chain, so stringifying one throws and the
 * Lambda returns nothing at all -- API Gateway turns that into a 502 and the real cause
 * survives only in CloudWatch. Errors are also awkward in their own right: their
 * properties are non-enumerable, so a plain stringify renders them as `{}`.
 *
 * Errors are therefore projected down to the fields worth returning, which both removes
 * the circular chain and stops us walking the SDK's buffered HTTP response. Anything else
 * that is somehow still circular degrades to a marker rather than taking the response down.
 */
const safeStringify = function (value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, function (key, val) {
      if (val instanceof Error) {
        return {
          name: val.name,
          message: val.message,
          ...(val.code !== undefined ? { code: val.code } : {})
        };
      }
      if (val !== null && typeof val === 'object') {
        if (seen.has(val)) {
          return '[Circular]';
        }
        seen.add(val);
      }
      return val;
    });
  } catch (err) {
    // Last resort: never let response serialization be the thing that fails the request.
    logger.error('Failed to serialize response body', err?.message || err);
    return JSON.stringify({
      code: 500,
      data: null,
      msg: 'Response could not be serialized',
      error: String(err?.message || err)
    });
  }
};

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
  const statusCode = normalizeStatusCode(code);

  // All responses must include the following fields as a minimum.
  let body = {
    code: statusCode,
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
    statusCode: statusCode,
    headers: headers,
    body: safeStringify(body),
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

const getNowEpoch = function () {
  return DateTime.now().toMillis();
}

const epochToISO = function (epochMillis, tz = DEFAULT_TIMEZONE) {
  return DateTime.fromMillis(epochMillis).setZone(tz).toISO();
}

const isoToEpoch = function (isoString) {
  return DateTime.fromISO(isoString).toMillis();
}

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

/**
 * Helper function to parse and remove key/data items from the object
 *
 * @param {Object} obj - object
 * @param {Array} fields - fields that need to be filtered out
 *
 * @returns {Object} Filtered object
 */
function removeFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  const filter = Object.fromEntries(
    Object.entries(obj).filter(([key]) => !fields.includes(key))
  );

  return filter;
}
  
/**
 * Filter and sanitize the response for user role
 *
 * @param {Object} res - response data object from dynamo query
 * @param {String} role - user role which is used for removing items
 * @param {Object} ROLE_BASED_FILTERS - object of roles with an array of attributes that
 *                                      need to be removed
 *
 * @returns {Object} Filtered response data object
 */
/**
 * Resolves the effective response-filtering role for a user against a specific
 * collection. Superadmin permissions live at the top level of authContext.permissions
 * (`{ superadmin: 'superadmin' }`) — without this helper, a per-collection lookup
 * misses that and falls through to 'default', which strips fields like adminNotes
 * even from superadmin responses.
 *
 * @param {Object} authContext - object returned by checkAuthContext
 * @param {string} collectionId - collection being read
 * @returns {string} role to pass to filterByRole
 */
function effectiveCollectionRole(authContext, collectionId) {
  if (authContext?.permissions?.['superadmin'] === 'superadmin') {
    return 'superadmin';
  }
  return authContext?.permissions?.[collectionId] ?? 'default';
}

function filterByRole(res, role = 'default', ROLE_BASED_FILTERS) {
  // Return the response as-is for superadmin
  if (role === 'superadmin') {
    return res
  }

  // Determine the fields to remove by role, e.g. "adminNotes" 
  // No role means user gets default role (least privilege)
  const fieldsToFilter = ROLE_BASED_FILTERS[role] ?? ROLE_BASED_FILTERS.default;
  
  // Use helper function to sanitize the res object with allowed items
  const sanitizedRes = Array.isArray(res) 
    ? res.map((obj) => removeFields(obj, fieldsToFilter)) 
    : removeFields(res, fieldsToFilter);

  return sanitizedRes;
}

/**
 * 
 * @param {Object} event - event object
 * @param {string} requiredTier - required tier ( e.g. limited, staff) required to continue
 * @param {string} collectionId - collectionId passed by endpoint
 * 
 * @returns {Object} - authContext from the event (given it passes all checks)
 */

function checkAuthContext(event, requiredTier = null, collectionId = null) {
  // Bypass auth checks when running locally with SAM
  if (process.env.AWS_SAM_LOCAL === 'true') {
    return {
      sub: 'local-dev',
      permissions: { superadmin: 'superadmin' },
    };
  }

  // Accept explicit collectionId (e.g. from query params) or fall back to path parameter
  const colId = collectionId || event?.pathParameters?.collectionId;
  
  try {
    const authContext = {
      sub: event.requestContext?.authorizer?.principalId || event.requestContext?.claims?.sub,
    };

    authContext.permissions = JSON.parse(event?.requestContext?.authorizer?.permissions || '{}');
    const isSuperAdmin = authContext.permissions['superadmin'] === 'superadmin';

    if (isSuperAdmin) {
      return authContext; // SuperAdmin has access to everything, don't need to check further
    }

    // If a collectionId is specified, check authContext.permissions for that collection
    if (colId) {
      if (!authContext.permissions[colId]) {
        throw new Exception(
          "Unauthorized: User does not have access to this specific collection.",
          { code: 403 },
        );
      }

      // If a requiredTier is specified e.g. 'staff' for POST/PUT,
      // verify the user's tier for this collection matches
      if (requiredTier && authContext.permissions[colId] !== requiredTier) {
        throw new Exception(
          `Unauthorized: User does not have the required permission tier for this operation.`,
          { code: 403 },
        );
      }

    // No collectionId — check that the user holds the required tier in at least one collection
    } else {
      if (requiredTier && !Object.values(authContext.permissions).includes(requiredTier)) {
        throw new Exception(
          `Unauthorized: User does not have the required permission tier for this operation.`,
          { code: 403 },
        );
      }
    }

    return authContext;
  } catch (e) {
    // Let errors bubble up
    if (e instanceof Exception) {
      throw e;
    }
    logger.warn('Could not parse permissions from authorizer context');
    throw new Exception("Unauthorized - Invalid permissions format", { code: 401 });
  }
}

function getRequestClaimsFromEvent(event) {
  try {
    // No longer decoding raw headers
    // Trusting only the authorizer context
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

    logger.info('No authenticated context found');
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

    const auditRecord = marshallFn({
      pk: user,
      sk: timestamp,
      gsipk: `entity::${entityId}`,
      gsisk: timestamp,
      operation: operation,
      metadata: {
        entityId,
        ...metadata,
        timestamp
      }
    }, { removeUndefinedValues: true });

    await batchWriteFn([auditRecord], 25, auditTableName);
    logger.debug('Audit log written', { user, entityId, operation });
  } catch (error) {
    // Log error but don't fail the request
    logger.error('Failed to write audit log', { error: error.message, user, entityId, operation });
  }
}

module.exports = {
  DateTime,
  Exception,
  buildDateTimeFromShortDate,
  buildDateRange,
  calculatePartySize,
  checkWarmup,
  epochToISO,
  handleCORS,
  getNow,
  getNowEpoch,
  getNowISO,
  effectiveCollectionRole,
  filterByRole,
  checkAuthContext,
  getRequestClaimsFromEvent,
  isoToEpoch,
  logger,
  sendMessage,
  sendResponse,
  safeStringify,
  httpGet,
  VALIDATION_PATTERNS,
  writeAuditLog
};
