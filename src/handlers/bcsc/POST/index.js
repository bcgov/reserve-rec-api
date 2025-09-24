const axios = require('axios');
const { logger } = require('/opt/base');

const TOKEN_ENDPOINTS = {
  dev: 'https://idtest.gov.bc.ca/oauth2/token',
  test: 'https://idtest.gov.bc.ca/oauth2/token',
  prod: 'https://id.gov.bc.ca/oauth2/token'
};

exports.handler = async (event) => {
  console.log('=== BCSC POST Handler Started ===');
  console.log('HTTP Method:', event.httpMethod);
  console.log('Event path:', event.path);
  console.log('Event headers:', JSON.stringify(event.headers, null, 2));
  console.log('Event body:', event.body);

  try {
    // Handle OPTIONS preflight
    if (event.httpMethod === 'OPTIONS') {
      console.log('Handling OPTIONS preflight request');
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
      console.error('Invalid path - no environment match found');
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
    console.log('=== Token Exchange for Environment:', env);
    
    const tokenUrl = TOKEN_ENDPOINTS[env];
    const headers = { ...event.headers };

    // Clean up headers
    delete headers.host;
    delete headers.Host;
    
    let body = event.body;
    if (event.isBase64Encoded) {
      body = Buffer.from(body, 'base64').toString('utf-8');
    }
    
    console.log('Making token exchange request to BCSC...');
    console.log('Target URL:', tokenUrl);
    console.log('Request body:', body);
    
    const response = await axios.post(tokenUrl, body, { 
      headers,
      timeout: 25000 // 25 second timeout
    });
    
    console.log('BCSC Response received:');
    console.log('Status:', response.status);
    console.log('Data:', response.data);
    
    const jsonResponse = { ...response.data };
    
    // Log what we're removing
    if (jsonResponse.id_token) {
      console.log('Removing id_token from response');
      console.log('ID token preview:', jsonResponse.id_token.substring(0, 50) + '...');
      delete jsonResponse.id_token;
    }
    
    console.log('Final response to client:', jsonResponse);
    
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
    console.error('=== ERROR in BCSC POST Handler ===');
    console.error('Error name:', err.name);
    console.error('Error message:', err.message);
    console.error('Error response:', err.response?.data);
    console.error('Error status:', err.response?.status);
    
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