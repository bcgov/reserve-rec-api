const {
  DynamoDBClient,
  DeleteItemCommand,
} = require("@aws-sdk/client-dynamodb");

const TABLE_NAME =
  process.env.REFERENCE_DATA_TABLE_NAME ||
  "your-table-name";
const REGION = process.env.AWS_REGION || "ca-central-1";

let _client;
function getClient() {
  if (!_client) {
    _client = new DynamoDBClient({ region: REGION });
  }
  return _client;
}

/**
 * Deletes counter records (sk = 'counter') for the given partition keys.
 *
 * Counter records are created by incrementCounter() and are not removed by
 * the normal entity-delete flow.
 *
 * Counter PK patterns:
 *   Activity:  activity::<collectionId>::<activityType>
 *   Product:   product::<collectionId>::<activityType>::<activityId>::counter
 *
 * NOTE: This helper calls DynamoDB directly and requires valid AWS credentials
 * in the environment (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY +
 * AWS_SESSION_TOKEN, or an active AWS profile).
 *
 * @param {string[]} pks - Partition keys of the counter records to delete.
 */
async function deleteCounters(pks) {
  const client = getClient();
  await Promise.all(
    pks.map((pk) =>
      client
        .send(
          new DeleteItemCommand({
            TableName: TABLE_NAME,
            Key: {
              pk: { S: pk },
              sk: { S: "counter" },
            },
          }),
        )
        .catch((err) => {
          console.log("err >>>", err);
          // A missing counter is harmless — ignore it; surface everything else.
          if (err.name !== "ResourceNotFoundException") {
            console.warn(
              `[dynamo-cleanup] Failed to delete counter for pk="${pk}":`,
              err.message,
            );
          }
        }),
    ),
  );
}

module.exports = { deleteCounters };
