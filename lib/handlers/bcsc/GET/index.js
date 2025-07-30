const axios = require('axios');
const { logger } = require('/opt/base');
const { JWTManager } = require('/opt/jwt'); 
const jwtManager = new JWTManager();

const USERINFO_ENDPOINTS = {
  dev: 'https://idtest.gov.bc.ca/oauth2/userinfo',
  test: 'https://idtest.gov.bc.ca/oauth2/userinfo',
  prod: 'https://id.gov.bc.ca/oauth2/userinfo'
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: ''
      };
    }
    
    // Handle JWKS endpoint
    if (event.path.includes('jwks')) {
      console.log('JWKS endpoint called');
      
      const jwks = jwtManager.generateJWKS();
      
      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,OPTIONS'
        },
        body: JSON.stringify(jwks)
      };
    }

    // Handle userinfo endpoints
    const match = event.path.match(/\/bcsc\/userinfo\/(dev|test|prod)/);
    if (match) {
      const env = match[1];
      const userinfoUrl = USERINFO_ENDPOINTS[env];
      const incomingHeaders = event.headers || {};
      const authHeader = incomingHeaders.Authorization || incomingHeaders.authorization;
      const headers = authHeader ? { Authorization: authHeader } : {};
      delete headers.host;
      
      const response = await axios.get(userinfoUrl, { headers });
      const jweToken = response.data;
      
      // Decrypt using the JWT layer
      const decryptedJWT = jwtManager.decryptJWE(jweToken);
      const payload = JSON.parse(Buffer.from(decryptedJWT.split('.')[1], 'base64url').toString());

      return {
        statusCode: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify(payload)
      };
    }
    
    return { 
      statusCode: 404, 
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: 'Not found', path: event.path })
    };

  } catch (err) {
    console.error('Error in BCSC handler:', err);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: err.message })
    };
  }
};