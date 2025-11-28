const { getOne, marshall, runQuery, batchGetData, REFERENCE_DATA_TABLE_NAME } = require("/opt/dynamodb");
const { Exception, getNowISO, logger } = require("/opt/base");
const { DEFAULT_API_UPDATE_CONFIG } = require("../common/data-constants");
const crypto = require("crypto");

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
 * @param {boolean} [config.autoGlobalId=false] - Automatically generate a globalId for each item.
 * @param {boolean} [config.failOnError=false] - Whether to throw an error if any item update fails.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of update objects.
 * @throws {Error} - Throws an error if the primary key is malformed or if no field data is provided.
 */
async function quickApiUpdateHandler(tableName, updateList, config = DEFAULT_API_UPDATE_CONFIG) {
  logger.debug(`Table name: ${tableName}`);
  logger.debug(`Update list:  ${JSON.stringify(updateList, null, 2)}`);

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

  // If no fields are provided, skip validation
  if (!itemConfig?.fields) {
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
        throw new Exception(`Invalid field.`, { code: 400, error: `Field '${field}' is not allowed in the request` });
      }

      // If the field is empty and allowEmpty is true, skip validation.
      if (fieldRules?.allowEmpty && (itemData[field].value === undefined || itemData[field].value === null || itemData[field].value === '')) {
        continue;
      }

      // If the field is an object with its own fields, validate the nested fields
      if (fieldRules?.hasOwnProperty('fields')) {
        // if the field is an array, we need to validate each item in the array
        if (Array.isArray(fieldRules.fields)) {
          if (!Array.isArray(itemData[field].value)) {
            throw new Exception(`Invalid field value.`, { code: 400, error: `Field '${field}' should be an array` });
          }
          // validate each item in the array
          for (const item of itemData[field].value) {
            try {
              validateRequestData(item, { fields: fieldRules.fields[0] || fieldRules.fields });
            } catch (error) {
              throw new Exception(`Validation failed for nested array item with index [${itemData[field].value.indexOf(item)}] in '${field}'`, { code: 400, error: error });
            }
          }
        } else {
          // recursively validate the field rules
          try {
            validateRequestData(itemData[field].value, fieldRules);
          } catch (error) {
            throw new Exception(`Validation failed for nested field in '${field}'`, { code: 400, error: error });
          }
        }
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

/**
 * Handles quick API Puts for a given table with a list of Put items.
 *
 * @async
 * @function quickApiPutHandler
 * @param {string} tableName - The name of the table to Put.
 * @param {Array<Object>} createList - A list of items to Put. Each item should contain a key and data.
 * @param {Object} [config] - Configuration options for the Put.
 * @returns {Promise<Array<Object>>} - A promise that resolves to an array of Put objects.
 * @throws {Error} - Throws an error if the primary key is malformed or if no field data is provided.
 */
async function quickApiPutHandler(tableName, createList, config) {
  // We need to ensure that the 'set' action is used for all fields.
  logger.debug(`Table name: ${tableName}`);
  logger.debug(`Create list: ${JSON.stringify(createList, null, 2)}`);

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

        // If overwrites are allowed, check if the item already exists
        let existingItem = null;
        if (itemConfig?.allowOverwrite) {
          existingItem = await getOne(itemData.pk, itemData.sk);
        }

        // Build the validation request
        let dataToValidate = buildValidationRequest(itemData, itemConfig?.fields);

        // validate the request data using the config
        validateRequestData(dataToValidate, itemConfig);

        if (itemConfig?.autoTimestamp) {
          itemData['creationDate'] = existingItem?.creationDate ? existingItem.creationDate : now;
          itemData['lastUpdated'] = now;
        }

        if (itemConfig?.autoVersion) {
          itemData['version'] = existingItem?.version ? existingItem.version + 1 : 1;
        }

        if (itemConfig?.autoGlobalId) {
          itemData['globalId'] = generateGlobalId();
        }

        let createCommand = {
          action: 'Put',
          data: {
            TableName: tableName,
            Item: marshall(itemData),
          }
        };

        // Prevent overwrites if config.allowOverwrite is false
        if (!itemConfig?.allowOverwrite) {
          createCommand.data.ConditionExpression = 'attribute_not_exists(pk) AND attribute_not_exists(sk)';
        }

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

function buildValidationRequest(itemData, configFields) {
  let nodeObj = {};
  Object.keys(itemData).map((item) => {
    // If the item is an array, we need to handle it differently
    if (configFields[item]?.hasOwnProperty('fields')) {
      if (Array.isArray(itemData[item])) {
        let arr = [];
        for (const arrayItem of itemData[item]) {
          arr.push(buildValidationRequest(arrayItem, configFields[item]?.fields[0] || configFields[item]?.fields));
        }
        nodeObj[item] = {
          value: arr,
          action: DEFAULT_FIELD_ACTION
        };
      } else {
        nodeObj[item] = {
          value: buildValidationRequest(itemData[item], configFields[item]?.fields),
          action: DEFAULT_FIELD_ACTION
        };
      }
    } else {
      nodeObj[item] = {
        value: itemData[item],
        action: DEFAULT_FIELD_ACTION
      };
    }
  });
  return nodeObj;
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

  logger.debug(`Update expression: ${updateExpression}`);
  logger.debug(`Expression Attribute Names: ${expressionAttributeNames}`);
  logger.debug(`Expression Attribute Values: ${expressionAttributeValues}`);

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
function buildCompKeysFromSkField(rootItem, pk, skField) {
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

/**
 * This function looks at properties of items that are expected to store primary keys. For each property, it retrieves the nested items from the database and attaches them to the item. The item's property originally is expected to contain either a single primary key or an array of primary keys. This function modifies the original item in place, replacing the property with the retrieved data.
 * @param {*} item The item to which nested properties will be attached.
 * @param {*} properties The array of property keys to retrieve and attach to the item. The item's property will be replaced with the retrieved data.
 */
async function getAndAttachNestedProperties(item, properties) {
  if (item?.length === 0) {
    return; // If the item is empty, there's nothing to do.
  }
  if (!properties || !Array.isArray(properties)) {
    throw new Exception("Failure getting nested properties.", { code: 400, error: `Item and properties must be provided, properties must be provided as an array of property keys. Received [item]: '${item}' and [properties]: '${properties}'.` });
  }
  for (const property of properties) {
    try {
      let keys = item?.[property];
      if (!keys || keys?.length === 0) {
        logger.warn(`Property '${property}' not found in item.: ${item}`);
        continue;
      }
      // Check if the property is an object or an array
      const isArray = Array.isArray(keys);
      // Convert the keys to an array if it's not already
      if (!isArray) {
        keys = [keys];
      }
      const nestedItems = await batchGetData(keys, REFERENCE_DATA_TABLE_NAME);
      if (isArray) {
        item[property] = nestedItems;
      } else {
        // If it's not an array, we assume it's a single item and assign it directly
        item[property] = nestedItems?.[0];
      }
      // For each key, format the request and get the nested items.
    } catch (error) {
      throw new Exception(`Failure getting nested property '${property}'.`, { code: 400, error: error });
    }
  }
}

function generateGlobalId() {
  return crypto.randomUUID();
}

module.exports = {
  buildCompKeysFromSkField,
  getAndAttachNestedProperties,
  getNextIdentifier,
  generateGlobalId,
  quickApiPutHandler,
  quickApiUpdateHandler,
};
