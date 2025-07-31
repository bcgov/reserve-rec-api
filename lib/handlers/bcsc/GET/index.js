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
  console.log('=== BCSC GET Handler Started ===');
  console.log('Event path:', event.path);
  console.log('Timestamp:', new Date().toISOString());

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
      console.log('=== JWKS Endpoint Called ===');
      
      const startTime = Date.now();
      const jwks = jwtManager.generateJWKS();
      const jwksTime = Date.now() - startTime;
      
      console.log(`JWKS generated in ${jwksTime}ms`);
      console.log('JWKS response:', JSON.stringify(jwks, null, 2));
      
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
      console.log(`=== UserInfo Request for ${env.toUpperCase()} ===`);
      
      const userinfoUrl = USERINFO_ENDPOINTS[env];
      console.log('Target URL:', userinfoUrl);
      
      const incomingHeaders = event.headers || {};
      const authHeader = incomingHeaders.Authorization || incomingHeaders.authorization;
      console.log('Auth header present:', !!authHeader);
      console.log('Auth header preview:', authHeader ? authHeader.substring(0, 30) + '...' : 'None');
      
      const headers = authHeader ? { Authorization: authHeader } : {};
      delete headers.host;
      
      console.log('Making BCSC API call...');
      const apiStartTime = Date.now();
      
      try {
        // Add timeout
        const response = await axios.get(userinfoUrl, { 
          headers,
          timeout: 25000 // 25 seconds
        });
        
        const apiTime = Date.now() - apiStartTime;
        console.log(`BCSC API call completed in ${apiTime}ms`);
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        
        const jweToken = response.data;
        console.log('JWE token type:', typeof jweToken);
        console.log('JWE token length:', jweToken?.length);
        console.log('JWE token preview:', typeof jweToken === 'string' ? jweToken.substring(0, 100) + '...' : jweToken);
        
        // Validate JWE format
        if (typeof jweToken !== 'string') {
          throw new Error(`Expected JWE string, got ${typeof jweToken}`);
        }
        
        // Make sure the tokem gives back 5 parts
        const parts = jweToken.split('.');
        console.log('JWE parts count:', parts.length);
        if (parts.length !== 5) {
          throw new Error(`Invalid JWE format: expected 5 parts, got ${parts.length}`);
        }
        
        console.log('Starting JWE decryption...');
        const decryptStartTime = Date.now();
        
        // Decrypt using the JWT layer
        const decryptedJWT = jwtManager.decryptJWE(jweToken);
        
        const decryptTime = Date.now() - decryptStartTime;
        console.log(`JWE decryption completed in ${decryptTime}ms`);
        console.log('Decrypted JWT preview:', decryptedJWT.substring(0, 100) + '...');
        
        console.log('Parsing JWT payload...');
        const jwtParts = decryptedJWT.split('.');
        if (jwtParts.length !== 3) {
          throw new Error(`Invalid JWT format: expected 3 parts, got ${jwtParts.length}`);
        }
        
        const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString());
        console.log('JWT payload keys:', Object.keys(payload));
        console.log('JWT payload preview:', JSON.stringify(payload, null, 2).substring(0, 500) + '...');

        return {
          statusCode: 200,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify(payload)
        };
        
      } catch (apiError) {
        const apiTime = Date.now() - apiStartTime;
        console.error(`API call failed after ${apiTime}ms:`, apiError.message);
        
        if (apiError.code === 'ECONNABORTED') {
          console.error('API call timed out');
        } else if (apiError.response) {
          console.error('API response error:', {
            status: apiError.response.status,
            data: apiError.response.data,
            headers: apiError.response.headers
          });
        }
        
        throw apiError;
      }
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
    console.error('=== ERROR in BCSC GET Handler ===');
    console.error('Error type:', err.constructor.name);
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ 
        error: err.message,
        errorType: err.constructor.name
      })
    };
  }
};