'use strict';

const SUPERADMIN = { superadmin: 'superadmin' };

// API Gateway event as the admin authorizer passes it to a handler; `body` is serialized, `overrides` replace any field.
function adminEvent({ permissions = SUPERADMIN, principalId = 'user-1', body, ...overrides } = {}) {
  return {
    httpMethod: 'GET',
    pathParameters: {},
    queryStringParameters: null,
    body: body === undefined ? null : JSON.stringify(body),
    requestContext: {
      authorizer: { principalId, permissions: JSON.stringify(permissions) },
    },
    ...overrides,
  };
}

// Handler response -> { status, ...parsed body }
function parse(res) {
  return { status: res.statusCode, ...JSON.parse(res.body) };
}

module.exports = { adminEvent, parse };
