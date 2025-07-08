
const { httpGet, logger } = require('/opt/base');


// Map environments to BCSC token endpoints
const TOKEN_ENDPOINTS = {
  dev: 'https://idtest.gov.bc.ca/oauth2/token',
  test: 'https://idtest.gov.bc.ca/oauth2/token',
  prod: 'https://id.gov.bc.ca/oauth2/token'
};

exports.handler = async (event) => {
  try {
    // Extract environment from path, e.g. /token/dev
    const match = event.path.match(/\/token\/(dev|test|prod)/);
    if (!match) {
      return { statusCode: 400, body: 'Invalid path' };
    }
    const env = match[1];
    const tokenUrl = TOKEN_ENDPOINTS[env];

    // Forward headers (except Host, which AWS sets)
    const headers = { ...event.headers };
    delete headers.host;

    // The body is base64-encoded if isBase64Encoded is true
    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf-8');
    }

    // Proxy the POST request to the BCSC token endpoint
    const response = await httpGet(tokenUrl, body, headers);
    console.log(`Response from ${env} token endpoint:`, response.data);
    logger.log(`Response from ${env} token endpoint:`, response.data);
    // Remove id_token from the response if present
    const jsonResponse = { ...response.data };
    delete jsonResponse.id_token;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(jsonResponse)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};