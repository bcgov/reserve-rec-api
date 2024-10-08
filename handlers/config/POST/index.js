const { dynamodb, TABLE_NAME } = require("/opt/dynamodb");
const { logger, sendResponse } = require("/opt/base");
const { decodeJWT, resolvePermissions } = require("/opt/permissions");
const { marshall } = require('@aws-sdk/util-dynamodb');

exports.handler = async (event, context) => {
    // Allow CORS
    if (event.httpMethod === 'OPTIONS') {
        return sendResponse(200, {}, 'Success', null, context);
    }

    const token = await decodeJWT(event);
    const permissionObject = resolvePermissions(token);
    if (permissionObject.isAdmin !== true) {
        return sendResponse(403, { msg: "Unauthorized" }, context);
    }
    let configObject = {
        TableName: TABLE_NAME,
    };

    try {
        logger.debug(event.body);
        let newObject = JSON.parse(event.body);

        configObject.Item = {};
        configObject.Item["pk"] = { S: "config" };
        configObject.Item["sk"] = { S: "config" };
        configObject.Item["configData"] = {
            M: marshall(newObject),
        };

        logger.debug("putting item:", configObject);
        const res = await dynamodb.putItem(configObject);
        logger.debug("res:", res);
        return sendResponse(200, res);
    } catch (err) {
        logger.error("err", err);
        return sendResponse(400, err);
    }
};
