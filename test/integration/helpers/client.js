const axios = require('axios');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

/**
 * Creates an axios instance pre-configured for the admin API.
 *
 * If no token is supplied, falls back to the TEST_AUTH_TOKEN environment
 * variable. Set that variable when targeting a deployed environment:
 *
 *   TEST_AUTH_TOKEN=<cognito_id_token> API_BASE_URL=https://... yarn test:integration
 *
 * @param {string} [token] - Optional Bearer token. Defaults to TEST_AUTH_TOKEN env var.
 * @returns {import('axios').AxiosInstance}
 */
function createClient(token) {
  const resolvedToken = token || process.env.TEST_AUTH_TOKEN;
  return axios.create({
    baseURL: BASE_URL,
    headers: {
      'Content-Type': 'application/json',
      ...(resolvedToken ? { Authorization: `Bearer ${resolvedToken}` } : {}),
    },
    // Return the response even for 4xx/5xx so tests can assert on status codes
    validateStatus: () => true,
  });
}

module.exports = { createClient, BASE_URL };
