'use strict';

const { logger, sendResponse } = require('/opt/base');
const { getActiveMode2Meta } = require('../utils/dynamodb');

/**
 * GET /waiting-room/mode2/status
 *
 * Public (no auth). Returns whether a Mode 2 queue is currently active
 * (the Mode 2 pointer names a queue that is not closed).
 * Used by the Angular public app on startup to decide whether to enforce
 * the Mode 2 waiting room guard on facility/cart routes.
 */
exports.handler = async (event) => {
  logger.debug('WaitingRoom GET mode2-status');

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
      },
      body: '',
    };
  }

  try {
    const active = !!(await getActiveMode2Meta());

    return sendResponse(200, { active }, 'Mode 2 status retrieved');
  } catch (err) {
    logger.error('WaitingRoom GET mode2-status error:', err);
    return sendResponse(500, null, 'Internal server error', err);
  }
};
