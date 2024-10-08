const AWS_REGION = process.env.AWS_REGION || 'local-env';
const ENDPOINT = 'http://127.0.0.1:8000';
const DYNAMODB_ENDPOINT_URL = process.env.DYNAMODB_ENDPOINT_URL || ENDPOINT;
const TABLE_NAME = process.env.TABLE_NAME || 'Reserve-Rec-tests';
const TIMEZONE = 'America/Vancouver';
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
let DBMODEL = require('../docs/dbModel.json');

const crypto = require('crypto');

process.env.LOG_LEVEL = 'info';
process.env.IS_OFFLINE = 'true';

async function createDB(items, tableName = TABLE_NAME) {
    // Set the TABLE_NAME to be the test table name in the database model.
    DBMODEL.TableName = tableName;
    const dynamodb = new DynamoDB({
        region: AWS_REGION,
        endpoint: DYNAMODB_ENDPOINT_URL,
        httpOptions: { timeout: 5000 }
    });

    try {
        await dynamodb.createTable(DBMODEL);
    } catch (err) {
        console.log(err);
    }

    // If there are no items to create after creating the DB, just return the client handler.
    if (!items) {
        return dynamodb;
    }

    // If the item passed in wasn't an array, turn it into one.
    if (!items.length) {
        items = [items];
    }

    for (const item of items) {
        await dynamodb.putItem({
            TableName: tableName,
            Item: marshall(item, {
                removeUndefinedValues: true
            })
        });
    }

    return dynamodb;
}

async function deleteDB(tableName = TABLE_NAME) {
    const dynamoDb = new DynamoDB({
        region: AWS_REGION,
        endpoint: DYNAMODB_ENDPOINT_URL
    });

    try {
        await dynamoDb
            .deleteTable({
                TableName: tableName
            });
    } catch (err) {
        console.log(err);
    }
}

async function putDB(data, tableName = TABLE_NAME) {
    const dynamodb = new DynamoDB({
        region: AWS_REGION,
        endpoint: DYNAMODB_ENDPOINT_URL,
    });

    // If data is a single item, make it an array
    if (!data.length) {
        data = [data];
    }
    for (const item of data) {
        await dynamodb.putItem({
            TableName: tableName,
            Item: marshall(item, {
                removeUndefinedValues: true
            })
        });
    }
}

async function getOneDB(pk, sk, tableName = TABLE_NAME) {
    const dynamodb = new DynamoDB({
        region: AWS_REGION,
        endpoint: DYNAMODB_ENDPOINT_URL
    });
    const query = {
        TableName: tableName,
        Key: marshall({ pk, sk })
    };
    let res = await dynamodb.getItem(query);
    return unmarshall(res.Item);
}

// Generate hashed text
function getHashedText(text) {
    return crypto.createHash('md5').update(text).digest('hex');
}

module.exports = {
    AWS_REGION,
    DBMODEL,
    DYNAMODB_ENDPOINT_URL,
    ENDPOINT,
    TABLE_NAME,
    TIMEZONE,
    createDB,
    deleteDB,
    getOneDB,
    getHashedText,
    putDB
};
