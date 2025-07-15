const axios = require('axios');
const { logger } = require('/opt/base');

// Map environments to BCSC userinfo endpoints
const USERINFO_ENDPOINTS = {
  dev: 'https://idtest.gov.bc.ca/oauth2/userinfo',
  test: 'https://idtest.gov.bc.ca/oauth2/userinfo',
  prod: 'https://id.gov.bc.ca/oauth2/userinfo'
};

exports.handler = async (event) => {
  try {
    if (event.path === '/jwks.json') {
      console.log('JWKS endpoint called');
      const jwks = {
        keys: [
          {
            kty: "RSA",
            kid: "REPLACE-WITH-KEY-WHEN-AVAILABLE",
            use: "enc",
            alg: "RS256",
            n: "base64url-modulus",
            e: "AQAB"
          }
        ]
      };
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jwks)
      };
    }

    const match = event.path.match(/\/userinfo\/(dev|test|prod)/);
    if (!match) {
      return { statusCode: 400, body: 'Invalid path' };
    }
    
    const env = match[1];
    const userinfoUrl = USERINFO_ENDPOINTS[env];
    const incomingHeaders = event.headers || {};
    const authHeader = incomingHeaders.Authorization || incomingHeaders.authorization;
    const headers = authHeader ? { Authorization: authHeader } : {};
    delete headers.host;
    const response = await axios.get(userinfoUrl, { headers });
    logger.log(`Response from ${env} userinfo endpoint:`, response.data, "headers:", response.headers);
    
    const jweToken = response.data;

    //WILL NEED TO DECRYPT HERE COGNITO NEEDS NORMAL JSON RESPONSE
    //IDIM WILL RETURN RAW FOR TEST BUT NEED TO HAVE IN PLACE FOR PROD
    const payload = JSON.parse(Buffer.from(jweToken.split('.')[1], 'base64url').toString());

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};