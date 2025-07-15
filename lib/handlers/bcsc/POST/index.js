const axios = require('axios');
const { logger } = require('/opt/base');

const TOKEN_ENDPOINTS = {
  dev: 'https://idtest.gov.bc.ca/oauth2/token',
  test: 'https://idtest.gov.bc.ca/oauth2/token',
  prod: 'https://id.gov.bc.ca/oauth2/token'
};

exports.handler = async (event) => {
  try {
    const match = event.path.match(/\/token\/(dev|test|prod)/);
    if (!match) {
      return { statusCode: 400, body: 'Invalid path' };
    }
    const env = match[1];
    const tokenUrl = TOKEN_ENDPOINTS[env];
    const headers = { ...event.headers };

    //Delete both headers because leaving one causes apigateway to fail
    delete headers.host;
    delete headers.Host;
    //Keep event body to send it forward
    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf-8');
    }
    const response = await axios.post(tokenUrl, body, { headers });
    logger.log(`Response.data from ${env} token endpoint:`, response.data);
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