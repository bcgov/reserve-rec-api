const { sendResponse, sendMessage } = require('/opt/base');
const { putItem, deleteItem, PUBSUB_TABLE_NAME } = require("/opt/dynamodb");

exports.handler = async (event, context) => {
  console.log("Event Type:", event.requestContext.eventType);
  console.log("Id:", event.requestContext.connectionId);

  switch (event.requestContext.eventType) {
    case 'CONNECT': {
      return await onConnect(event);
    }
    case 'MESSAGE': {
      return await onMessage(event);
    }
    case 'DISCONNECT': {
      return await onDisconnect(event);
    }
    default: {
      return sendResponse(400, JSON.stringify(connectionData));
    }
  }
};

/**
 * Handles the WebSocket connection event.
 *
 * @param {Object} event - The event object containing details about the WebSocket connection.
 * @param {Object} event.requestContext - The request context object.
 * @param {string} event.requestContext.connectionId - The unique identifier for the WebSocket connection.
 * @param {string} event.requestContext.domainName - The domain name of the WebSocket connection.
 * @param {string} event.requestContext.stage - The deployment stage of the WebSocket connection.
 * @returns {Promise<Object>} - A promise that resolves to the response object with status code 200.
 */
async function onConnect(event) {
  console.log(`Received socket connectionId: ${event.requestContext && event.requestContext.connectionId}`);

  // Put this into the DB
  const item = {
    pk: { S: 'websocket' },
    sk: { S: event.requestContext.connectionId },
    timestamp: { S: new Date().toISOString() }
  };

  console.log("Putting item:", item);
  await putItem(item, PUBSUB_TABLE_NAME);
  console.log("Item put successfully");
  await sendMessage(event.requestContext.connectionId, event.requestContext.domainName, event.requestContext.stage);
  console.log("Message sent successfully");
  return sendResponse(200, {});
}

/**
 * Handles incoming WebSocket messages.
 *
 * @param {Object} event - The event object containing the WebSocket message.
 * @param {Object} event.requestContext - The request context object.
 * @param {string} event.requestContext.connectionId - The connection ID of the WebSocket client.
 * @param {string} event.body - The body of the WebSocket message.
 * @returns {Promise<Object>} A promise that resolves to the response object.
 */
async function onMessage(event) {
  console.log(`Received socket message from: ${event.requestContext.connectionId}`);

  const body = JSON.parse(event.body);
  console.log("Body:", body);

  return sendResponse(200, {});
}

/**
 * Handles the disconnection event for a WebSocket connection.
 *
 * @param {Object} event - The event object containing details of the disconnection.
 * @param {Object} event.requestContext - The request context object.
 * @param {string} event.requestContext.connectionId - The ID of the WebSocket connection.
 * @returns {Promise<Object>} - A promise that resolves to the response object.
 */
async function onDisconnect(event) {
  const connectionId = event.requestContext.connectionId;
  const item = {
    pk: 'websocket',
    sk: connectionId
  };

  await deleteItem(item.pk, item.sk, PUBSUB_TABLE_NAME);

  return sendResponse(200, {});
}