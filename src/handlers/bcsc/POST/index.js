const axios = require('axios');
const { logger } = require('/opt/base');

const TOKEN_ENDPOINTS = {
  dev: 'https://idtest.gov.bc.ca/oauth2/token',
  test: 'https://idtest.gov.bc.ca/oauth2/token',
  prod: 'https://id.gov.bc.ca/oauth2/token'
};

// Proxies the BC Services Card OAuth token exchange. The request headers/body carry the
// BCSC client_secret and the one-time authorization code, and the response carries the
// access and id tokens — none of that may be logged (it lands in CloudWatch). Only
// non-sensitive operational fields (method, path, env, status) are logged here.
exports.handler = async (event) => {
  logger.info('BCSC token exchange request', { method: event.httpMethod, path: event.path });

  try {
    // Handle OPTIONS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'POST,OPTIONS'
        },
        body: ''
      };
    }

    const match = event.path.match(/\/bcsc\/token\/(dev|test|prod)/);
    if (!match) {
      logger.warn('BCSC token exchange: invalid path format');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'invalid_request',
          error_description: 'Invalid path format'
        })
      };
    }

    const env = match[1];
    const tokenUrl = TOKEN_ENDPOINTS[env];
    const headers = { ...event.headers };

    // Clean up headers
    delete headers.host;
    delete headers.Host;

    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf-8');
    }

    const response = await axios.post(tokenUrl, body, {
      headers,
      timeout: 25000 // 25 second timeout
    });
    logger.info('BCSC token exchange completed', { env, status: response.status });

    const jsonResponse = { ...response.data };

    // id_token is stripped before returning to the client
    delete jsonResponse.id_token;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'POST,OPTIONS'
      },
      body: JSON.stringify(jsonResponse)
    };

  } catch (err) {
    logger.error('BCSC token exchange failed', {
      name: err.name,
      message: err.message,
      status: err.response?.status
    });

    return {
      statusCode: err.response?.status || 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'server_error',
        error_description: err.message,
        bcsc_error: err.response?.data
      })
    };
  }
};
