const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");

const SNS_ENDPOINT_URL = process.env.SNS_ENDPOINT_URL;
const IS_OFFLINE = process.env.IS_OFFLINE === 'true' || process.env.IS_OFFLINE === true;

// Configure SNS client - use a valid AWS region, not "local-env"
const snsClientConfig = {
  region: process.env.AWS_DEFAULT_REGION || 'ca-central-1'
};

// For local development, override with custom endpoint
if (SNS_ENDPOINT_URL || IS_OFFLINE) {
  // Use host.docker.internal for Docker containers to reach host machine
  snsClientConfig.endpoint = SNS_ENDPOINT_URL || 'http://host.docker.internal:4100';
  // Add dummy credentials for local development
  snsClientConfig.credentials = {
    accessKeyId: 'dummy',
    secretAccessKey: 'dummy'
  };
}

const snsClient = new SNSClient(snsClientConfig);

/**
 * 
 * @param {string} topicArn - The ARN of the SNS topic
 * @param {object} message - The message payload to be sent to SNS
 * @param {string} subject - The subject of the message
 * @param {object} messageAttributes - Optional message attributes
 * @returns 
 */
function snsPublishCommand(topicArn, message, subject, messageAttributes = {}) {
  return new PublishCommand({
    TopicArn: topicArn,
    Message: JSON.stringify(message),
    Subject: subject,
    MessageAttributes: messageAttributes
  });
}

async function snsPublishSend(command) {
  return snsClient.send(command);
}
  
module.exports = {
  snsPublishSend,
  snsPublishCommand
};
