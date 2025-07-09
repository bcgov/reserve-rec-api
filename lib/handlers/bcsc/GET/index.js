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
    console.log('Received event:', JSON.stringify(event, null, 2));
    // Handle JWKS endpoint
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

      console.log('Returning JWKS:', jwks);
      logger.log('Returning JWKS:', jwks);
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jwks)
      };
    }

    // Extract environment from path, e.g. /userinfo/dev
    const match = event.path.match(/\/userinfo\/(dev|test|prod)/);
    if (!match) {
      return { statusCode: 400, body: 'Invalid path' };
    }
    console.log('Matched environment:', match[1]);
    const env = match[1];
    const userinfoUrl = USERINFO_ENDPOINTS[env];

    // Prepare headers, remove 'host' if present
    const headers = { ...event.headers.authorization ? { Authorization: event.headers.authorization } : {} };
    delete headers.host;

    // Make the request to userinfo endpoint
    console.log(`Making request to ${env} userinfo endpoint:`, userinfoUrl, "headers:", headers);
    try{
      const response = await axios.get(userinfoUrl, { headers });
    }catch(error) {
      console.error(`Error making request to ${env} userinfo endpoint:`, error.message);
      logger.log(`Error making request to ${env} userinfo endpoint:`, error.message);
    }
    console.log(`Response from ${env} userinfo endpoint:`, response.data, "headers:", response.headers);
    logger.log(`Response from ${env} userinfo endpoint:`, response.data, "headers:", response.headers);
    
    const jweToken = response.data;

    console.log(`JWE Token from ${env} userinfo endpoint:`, jweToken);
    logger.log(`JWE Token from ${env} userinfo endpoint:`, jweToken);

    //WILL NEED TO DECRYPT HERE COGNITO NEEDS NORMAL JSON RESPONSE
    //IDIM WILL RETURN RAW FOR TEST BUT NEED TO HAVE INPLACE FOR PROD
    const token = jweToken; // rename if needed
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    console.log('Decoded JWT payload:', payload);
    logger.log('Decoded JWT payload:', payload);


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