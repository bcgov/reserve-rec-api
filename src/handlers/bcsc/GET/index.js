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
  logger.debug('=== BCSC GET Handler Started ===');
  logger.debug('Event path:', event.path);

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
      logger.debug('=== JWKS Endpoint Called ===');
      
      const jwks = await jwtManager.generateJWKS();
      
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
      logger.debug(`=== UserInfo Request for ${env.toUpperCase()} ===`);
      
      const userinfoUrl = USERINFO_ENDPOINTS[env];
      logger.debug('Target URL:', userinfoUrl);
      
      const incomingHeaders = event.headers || {};
      const authHeader = incomingHeaders.Authorization || incomingHeaders.authorization;

      const headers = authHeader ? { Authorization: authHeader } : {};
      delete headers.host;
      
      logger.debug('Making BCSC API call...');
      const apiStartTime = Date.now();
      try {
        // Add timeout
        const response = await axios.get(userinfoUrl, { 
          headers,
          timeout: 25000 // 25 seconds
        });
        
        logger.debug('Response status:', response.status);
        logger.debug('Response headers:', response.headers);
        
        const jweToken = response.data;
        logger.debug('JWE token type:', typeof jweToken);
        logger.debug('JWE token preview:', typeof jweToken === 'string' ? jweToken.substring(0, 100) + '...' : jweToken);
        
        // Validate JWE format
        if (typeof jweToken !== 'string') {
          throw new Error(`Expected JWE string, got ${typeof jweToken}`);
        }
        
        // Make sure the token gives back 5 parts
        const parts = jweToken.split('.');
        if (parts.length !== 5) {
          throw new Error(`Invalid JWE format: expected 5 parts, got ${parts.length}`);
        }
        
        logger.debug('Starting JWE decryption...');

        // Decrypt using the JWT layer
        const decryptedJWT = await jwtManager.decryptJWE(jweToken);
        
        const jwtParts = decryptedJWT.split('.');
        if (jwtParts.length !== 3) {
          throw new Error(`Invalid JWT format: expected 3 parts, got ${jwtParts.length}`);
        }
        
        const payload = JSON.parse(Buffer.from(jwtParts[1], 'base64url').toString());
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
        logger.error(`API call failed after ${apiTime}ms:`, apiError.message);
        
        if (apiError.code === 'ECONNABORTED') {
          logger.error('API call timed out');
        } else if (apiError.response) {
          logger.error('API response error:', {
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
    logger.error('=== ERROR in BCSC GET Handler ===');
    logger.error('Error type:', err.constructor.name);
    logger.error('Error message:', err.message);

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