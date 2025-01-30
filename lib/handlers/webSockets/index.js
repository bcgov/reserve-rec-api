const { sendResponse } = require('/opt/base');
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

async function onConnect(event) {
  console.log(`Received socket connectionId: ${event.requestContext && event.requestContext.connectionId}`);

  // Put this into the DB
  const item = {
    pk: { S: 'websocket' },
    sk: { S: event.requestContext.connectionId },
    timestamp: { S: new Date().toISOString() }
  }

  console.log("Putting item:", item);
  await putItem(item, PUBSUB_TABLE_NAME);

  return sendResponse(200, {});
}

async function onMessage(event) {
  console.log(`Received socket message from: ${event.requestContext.connectionId}`);

  const body = JSON.parse(event.body);
  const targetConnectionId = event.requestContext.connectionId;
  const message = "Testing message";

  const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
    endpoint: `${event.requestContext.domainName}/${event.requestContext.stage}`
  });

  const params = {
    ConnectionId: targetConnectionId,
    Data: JSON.stringify({ message })
  };

  try {
    await apigatewaymanagementapi.postToConnection(params).promise();
    console.log(`Message sent to connectionId: ${targetConnectionId}`);
  } catch (error) {
    console.error(`Failed to send message to connectionId: ${targetConnectionId}`, error);
  }

  return sendResponse(200, {});
}

async function onDisconnect(event) {
  const connectionId = event.requestContext.connectionId;
  const item = {
    pk: 'websocket',
    sk: connectionId
  }

  await deleteItem(item.pk, item.sk, PUBSUB_TABLE_NAME);

  return sendResponse(200, {});
}