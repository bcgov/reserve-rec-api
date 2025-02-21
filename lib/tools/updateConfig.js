const AWS = require('aws-sdk');
const fs = require('fs');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const updateConfig = async (attributes, validAttributes, sk) => {
    const updateExpressionParts = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    let i = 0;
    for (const attributeName in attributes) {
        if (validAttributes.includes(attributeName)) {
            const attributeValue = attributes[attributeName];
            const finalAttributeName = attributeName
                .replace(/([A-Z])/g, '_$1')
                .toUpperCase()
                .replace(/^_/, '');

            const placeholderKey = `:value${i}`;
            const attributeNameKey = `#attr${i}`;

            updateExpressionParts.push(`${attributeNameKey} = ${placeholderKey}`);
            expressionAttributeValues[placeholderKey] = { S: attributeValue };
            expressionAttributeNames[attributeNameKey] = finalAttributeName;
            i++;
        }
    }

    const params = {
        TableName: process.env.TABLE_NAME || 'reserve-rec-config',
        Key: {
            PK: 'config',
            SK: sk,
        },
        UpdateExpression: `SET ${updateExpressionParts.join(', ')}`,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        ReturnValues: 'ALL_NEW',
    };

    try {
        const result = await dynamodb.update(params).promise();
        return result.Attributes;
    } catch (error) {
        console.error('Error updating config:', error);
        throw error;
    }
};

const parseArguments = () => {
    const args = process.argv.slice(2);

    if (args.length < 3) {
        throw new Error("Please provide the paths to the cfn-output.json file, valid attributes file, the SK value, and the stack name.");
    }

    const sk = args[2];
    const stackName = args[3]; // Get the stack name from arguments

    try {
        const cfnOutput = JSON.parse(fs.readFileSync(args[0], 'utf8'));
        const attributes = cfnOutput[stackName]; // Access attributes using stackName
        const validAttributes = JSON.parse(fs.readFileSync(args[1], 'utf8'));
        return { attributes, validAttributes, sk };
    } catch (e) {
        throw new Error("Error reading or parsing input files: " + e.message);
    }
};

const { attributes, validAttributes, sk } = parseArguments();

updateConfig(attributes, validAttributes, sk)
    .then(updatedItem => {
        console.log('Config updated successfully:', updatedItem);
    })
    .catch(error => {
        console.error('Failed to update config:', error);
    });

// Usage example:
// export TABLE_NAME=your-table-name
// node updateConfig.js cfn-output.json valid_attributes.json your-sk-value your-stack-name

// attributes.json (Everything shoud be in PascalCase):
// {
//     "UserPoolId": "whatever1",
//     "UserPoolClientId": "whatever2",
//     "IdentityPoolId": "whatever3",
//     "OauthDomain": "whatever4",
//     "InvalidAttribute": "whatever5"
// }

// valid_attributes.json:
// [
//     "UserPoolId",
//     "UserPoolClientId",
//     "IdentityPoolId",
//     "OauthDomain"
// ]