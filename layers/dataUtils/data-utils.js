const { marshall, runQuery } = require("/opt/dynamodb");
const { Exception, getNowISO, logger } = require("/opt/base");
const { DEFAULT_API_UPDATE_CONFIG } = require("/opt/data-constants");

const DEFAULT_FIELD_ACTION = 'set';
const FIELD_ACTIONS = ['set', 'add', 'append', 'remove'];

/**
 * Handles quick API updates for a given table with a list of update items.
 *
 * @async
 * @function quickApiUpdateHandler
 * @param {string} tableName - The name of the table to update.
 * @param {Array<Object>} updateList - A list of items to update. Each item should contain a key and data.
 * @param {Object} [config=DEFAULT_API_UPDATE_CONFIG] - Configuration options for the update.
 * @param {boolean} [config.autoTimestamp=false] - Whether to automatically add a timestamp to each item.
 * @param {boolean} [config.autoVersion=false] - Whether to automatically bump the version number of each item.
 * @param {boolean} [config.failOnError=false] - Whether to throw an error if any item update fails.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of update objects.
 * @throws {Error} - Throws an error if the primary key is malformed or if no field data is provided.
 */
async function quickApiUpdateHandler(tableName, updateList, config = DEFAULT_API_UPDATE_CONFIG) {
  logger.debug('Table name', tableName);
  logger.debug('Update list', JSON.stringify(updateList, null, 2));

  let now = getNowISO();
  let updateItems = [];

  try {
    for (let item of updateList) {
      try {
        // set the api config for the item
        let itemConfig = item?.config ? item.config : config;


        // Extract keys from item
        let key = item?.key;
        if (!key || !key?.pk || !key?.sk) {
          throw new Exception(`Malformed item primary key: ${key}`, { code: 400, error: `Item key must be of the form: {pk: <partition-key>, sk: <sort-key>}` });
        }

        // Extract the data from the item and force it to be of the form field: {value: <value>, action?: <action>}
        let itemData = {};
        for (const field of Object.keys(item?.data)) {
          if (item?.data[field]?.hasOwnProperty('value')) {
            itemData[field] = item.data[field];
          } else {
            itemData[field] = { value: item?.data[field], action: DEFAULT_FIELD_ACTION };
          }
        }

        if (Object.keys(itemData).length === 0) {
          throw new Exception(`No field data provided with item.`, { code: 400, error: `Item data should be of the form: {field: {value: <value>, action?: <action>}}` });
        }

        // validate the request data using the config
        validateRequestData(itemData, itemConfig);

        // Add lastUpdated field to each item if config.autoTimestamp is true
        if (itemConfig?.autoTimestamp) {
          itemData['lastUpdated'] = { value: now, action: 'set' };
        }

        // Bump version number if config.autoVersion is true
        if (itemConfig?.autoVersion) {
          itemData['version'] = { value: 1, action: 'add' };
        }

        // Build update expression
        const { updateExpression, expressionAttributeNames, expressionAttributeValues } = updateExpressionBuilder(itemData);

        // Create updateObject
        const updateObj = {
          action: 'Update',
          data: {
            TableName: tableName,
            Key: marshall(item.key),
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ConditionExpression: 'attribute_exists(pk)',
          }
        };

        // remove ExpressionAttributeValues if empty (possible if action is remove only)
        if (Object.keys(expressionAttributeValues).length === 0) {
          delete updateObj.data.ExpressionAttributeValues;
        }
        updateItems.push(updateObj);


      } catch (error) {
        // If failOnError is true, throw the error
        if (config?.failOnError) {
          throw error;
        }
        logger.error(error);
      }
    }
    return updateItems;
  } catch (error) {
    throw error;
  }

}

/**
 * Validates the request data against the provided configuration.
 *
 * @param {Object} itemData - The data to be validated.
 * @param {Object} itemConfig - The configuration object containing validation rules.
 * @param {Object} itemConfig.fields - The fields configuration object.
 * @param {boolean} [itemConfig.developerMode] - If true, skips validation.
 *
 * @throws {Exception} Throws an exception if validation fails.
 * @throws {Exception} Throws an exception if a mandatory field is missing.
 * @throws {Exception} Throws an exception if a field is duplicated.
 * @throws {Exception} Throws an exception if a field is not allowed.
 * @throws {Exception} Throws an exception if a field validation rule fails.
 */
function validateRequestData(itemData, itemConfig) {
  // If developer mode is enabled, skip validation
  if (itemConfig?.developerMode) {
    return;
  }

  let dupeCheck = new Set();

  // validate all the fields using the rules in the config.
  try {

    // check if all mandatory fields are present
    const configProperties = Object.keys(itemConfig?.fields);
    const mandatoryFields = configProperties.filter((field) => itemConfig?.fields?.[field]?.isMandatory);
    if (mandatoryFields.length > 0) {
      for (const field of mandatoryFields) {
        if (!itemData[field]) {
          throw new Exception(`Mandatory field '${field}' is missing in the request`, { code: 400, error: `Field '${field}' is mandatory` });
        }
      }
    }

    // iterate through field rules and validate each field
    for (const field of Object.keys(itemData)) {
      // Check for duplicate fields
      if (dupeCheck.has(field)) {
        throw new Exception(`Malformed request: Duplicate fields detected`, { code: 400, error: `Field '${field}' is present multiple times in the request` });
      }
      dupeCheck.add(field);

      const fieldRules = itemConfig?.fields[field];

      // If fieldRules is not present, the field is not allowed in the request
      if (!fieldRules) {
        throw new Exception(`Field '${field}' is not allowed in the request`, { code: 400, error: `Field '${field}' is not allowed in the request` });
      }

      // Execute the rule function for the field value
      // If any of the rules fail, an exception will be thrown and this function will exit
      // For validation to succeed, all rules must pass.
      if (fieldRules?.hasOwnProperty('rulesFn')) {
        try {
          fieldRules?.rulesFn(itemData[field]);
        } catch (error) {
          throw new Exception(`Validation failed for field '${field}'`, { code: 400, error: error });
        }
      }
    }

  } catch (error) {
    throw error;
  }
}

async function quickApiCreateHandler(tableName, createList, config = DEFAULT_API_UPDATE_CONFIG) {
  // We need to ensure that the 'set' action is used for all fields.
  logger.debug('Table name', tableName);
  logger.debug('Create list', JSON.stringify(createList, null, 2));

  let now = getNowISO();
  let createItems = [];

  try {

    for (let item of createList) {

      try {
        // set the api config for the item
        let itemConfig = item?.config ? item.config : config;
        let itemData = item?.data;

        if (Object.keys(itemData).length === 0) {
          throw new Exception(`No field data provided with item.`, { code: 400, error: `Item data should be of the form: {field: <value>}` });
        }

        let dataToValidate = {};
        Object.keys(itemData).map((field) => {
          dataToValidate[field] = {
            value: itemData[field],
            action: 'set'
          };
        });

        // validate the request data using the config
        validateRequestData(dataToValidate, itemConfig);

        if (itemConfig?.autoTimestamp) {
          itemData['creationDate'] = now;
          itemData['lastUpdated'] = now;
        }

        if (itemConfig?.autoVersion) {
          itemData['version'] = 1;
        }

        let createCommand = {
          action: 'Put',
          data: {
            TableName: tableName,
            Item: marshall(itemData),
            ConditionExpression: 'attribute_not_exists(pk)',
          }
        };
        createItems.push(createCommand);
      } catch (error) {
        if (config?.failOnError) {
          throw error;
        }
        logger.error(error);
      }
    }
    return createItems;
  } catch (error) {
    throw error;
  }
}

/**
 * Builds an update expression, expression attribute names, and expression attribute values for DynamoDB update operations.
 *
 * @param {Array} allFields - An array containing the fields to be updated.
 * @param {Object} item - The item containing the values to be updated.
 * @returns {Object} - An object containing the update expression, expression attribute names, and expression attribute values.
 */
function updateExpressionBuilder(itemData) {
  // Build update expression
  let setExpression = '', removeExpression = '';
  let setNames = {}, setValues = {}, removeNames = {};

  let allFields = {};
  FIELD_ACTIONS.map((action) => {
    allFields[action] = Object.keys(itemData).filter((field) => itemData[field].action === action);
  });

  // Handle SET expression
  if (allFields.set?.length > 0 || allFields.add?.length > 0 || allFields.append?.length > 0) {

    setExpression = 'SET';
    let setExpPortion = '', addExpPortion = '', appendExpPortion = '';

    // Combine set expressions
    if (allFields.set?.length > 0) {
      setExpPortion = allFields.set.map((field) => ` #${field} = :${field}`);
      allFields.set.map((field) => setNames[`#${field}`] = field);
      allFields.set.map((field) => setValues[`:${field}`] = marshall(itemData[field].value, {
        convertTopLevelContainer: true,
        removeUndefinedValues: true
      }));
    }

    // Combine add expressions
    if (allFields.add?.length > 0) {
      addExpPortion = allFields.add.map((field) => ` #${field} = if_not_exists(#${field}, :add__start__value) + :${field}`);
      setValues[`:add__start__value`] = marshall(0);
      allFields.add.map((field) => setNames[`#${field}`] = field);
      allFields.add.map((field) => setValues[`:${field}`] = marshall(itemData[field].value, {
        removeUndefinedValues: true
      }));
    }

    // Combine append expressions
    if (allFields.append?.length > 0) {
      appendExpPortion += allFields.append.map((field) => ` #${field} = list_append(if_not_exists(#${field}, :append__start__value), :${field})`);
      setValues[`:append__start__value`] = { L: [] };
      allFields.append.map((field) => setNames[`#${field}`] = field);
      allFields.append.map((field) => setValues[`:${field}`] = marshall(itemData[field].value, {
        convertTopLevelContainer: true,
        removeUndefinedValues: true
      }));
    }

    // Combine SET expressions
    setExpression += [setExpPortion, addExpPortion, appendExpPortion].filter((exp) => exp?.length > 0).join(',');
  }

  // Handle REMOVE expression
  if (allFields.remove?.length > 0) {
    removeExpression = 'REMOVE' + allFields.remove.map((field) => ` #${field}`).join(',');
    allFields.remove.map((field) => removeNames[`#${field}`] = field);
  }

  // Combine all expressions
  let updateExpression = [setExpression, removeExpression].filter((exp) => exp.length > 0).join(' ');
  const expressionAttributeNames = { ...setNames, ...removeNames };
  const expressionAttributeValues = { ...setValues };

  logger.debug('Update expression:', updateExpression);
  logger.debug('Expression Attribute Names:', expressionAttributeNames);
  logger.debug('Expression Attribute Values:', expressionAttributeValues);

  return { updateExpression, expressionAttributeNames, expressionAttributeValues };
}

/**
 * Retrieves the next identifier for a given table by querying existing items and determining the highest identifier value.
 *
 * @param {string} tableName - The name of the table to query.
 * @param {string} pk - The partition key value to query.
 * @param {string} identifierField - The field name of the identifier to evaluate.
 * @param {string} [skStartsWith=null] - Optional sort key prefix to filter the query.
 * @returns {Promise<number>} - The next identifier value.
 */
async function getNextIdentifier(tableName, pk, identifierField, skStartsWith = null) {
  // get the existing items
  const queryCommand = {
    TableName: tableName,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: pk },
    },
  };
  if (skStartsWith) {
    queryCommand.KeyConditionExpression += ' AND begins_with(sk, :sk)';
    queryCommand.ExpressionAttributeValues[':sk'] = { S: skStartsWith };
  }

  let items = await runQuery(queryCommand, null, null, false);

  let nextId = 0;

  if (items?.items?.length > 0) {
    nextId = items.items.reduce((acc, val) => {
      let id = Number(val[identifierField]);
      return id > acc ? id : acc;
    }, nextId);
  }
  return nextId + 1;
}

/**
 * Builds an array of composite keys (pk/sk) from a specified field of sort keys in the root item.
 *
 * @param {Object} rootItem - The root item containing the field to build keys from.
 * @param {string|Function} pk - The partition key or a function to generate the partition key from the root item.
 * @param {string} skField - The field name in the root item that contains sort keys.
 * @returns {Array<Object>} An array of objects containing the partition key (pk) and sort key (sk) of each item.
 */
function buildCompKeysFromSkField(rootItem, pk, skField){
  let keys = [];
  for (const item of rootItem?.[skField]) {
    let pkValue = pk;
    if (typeof pk === 'function') {
      pkValue = pk(rootItem);
    }
    keys.push({ pk: pkValue, sk: item });
  }
  return keys;
}

module.exports = {
  buildCompKeysFromSkField,
  getNextIdentifier,
  quickApiCreateHandler,
  quickApiUpdateHandler,
};