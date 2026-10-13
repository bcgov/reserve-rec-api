'use strict';

const { reply } = require('./store');

exports.handler = async () => reply({ type: 'pong' });
