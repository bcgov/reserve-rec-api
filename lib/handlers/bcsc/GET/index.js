const { httpGet, logger } = require('/opt/base');


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
    const headers = event.headers || {};

    // Make the request to user/info endpoint
    console.log(`Making request to ${env} userinfo endpoint:`, userinfoUrl, "headers:", headers ? headers : "No headers provided");
    const response = await httpGet(userinfoUrl, null, headers);
    const jweToken = response.data;

    console.log(`JWE Token from ${env} userinfo endpoint:`, jweToken);
    logger.log(`JWE Token from ${env} userinfo endpoint:`, jweToken);
    //WILL NEED TO DECRYPT HERE COGNITO NEEDS NORMAL JSON RESPONSE
    //IDIM WILL RETURN RAW FOR TEST BUT NEED TO HAVE INPLACE FOR PROD
   
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jweToken })
      // body: JSON.stringify(decrypted)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
