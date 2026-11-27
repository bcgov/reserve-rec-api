'use strict';

// Requires the test file to jest.mock('@aws-sdk/client-apigatewaymanagementapi') first.
function mockWebSocket() {
  const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
  PostToConnectionCommand.mockImplementation(function (input) { this.input = input; });
  const send = jest.fn().mockResolvedValue({});
  ApiGatewayManagementApiClient.mockImplementation(() => ({ send }));

  const messages = () => send.mock.calls.map(([cmd]) => [cmd.input.ConnectionId, JSON.parse(cmd.input.Data.toString())]);
  const ofType = type => messages().filter(([, m]) => m.type === type);
  return { send, messages, ofType };
}

module.exports = { mockWebSocket };
