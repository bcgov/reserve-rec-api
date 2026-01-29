const crypto = require('crypto');
const { TABLE_NAME, REFERENCE_DATA_TABLE_NAME, batchTransactData, runQuery, getOne, parallelizedBatchGetData, marshall, incrementCounter, batchGetData } = require('/opt/dynamodb');
const { Exception, buildDateRange, buildDateTimeFromShortDate, getNow, logger } = require('/opt/base');
const { POLICY_TYPES } = require('../policies/configs');
const { PRODUCT_API_PUT_CONFIG, PRODUCT_DAILY_PROPERTIES_CONFIG, PRODUCT_DEFAULT_PROPERTY_NAMES, PRODUCT_DEFAULT_SCHEDULE_RANGE, ALLOWED_FILTERS } = require('./configs');
const { quickApiPutHandler } = require('../../common/data-utils');

/**
 * Adds any filter expressions if any filters were added to query.
 *
 * @param {Object} queryObj - The object query
 * @param {Array} filters - Filter items that are passed from the query
 *
 * @returns {Object} the queryObj with any FilterExpressions added
 *
 */
function addFilters(queryObj, filters) {
  try {
    ALLOWED_FILTERS.forEach((item) => {
      if (item.name in filters) {
        if (queryObj.FilterExpression) {
          queryObj.FilterExpression += " AND ";
        } else if (!queryObj.FilterExpression) {
          queryObj.FilterExpression = "";
        }

        if (!queryObj.ExpressionAttributeNames) {
          queryObj.ExpressionAttributeNames = {};
        }

        if (item.type == "list") {
          queryObj.FilterExpression += `contains(#${item.name}, :${item.name})`;
        } else {
          queryObj.FilterExpression += `#${item.name} = :${item.name}`;
        }

        queryObj.ExpressionAttributeNames[`#${item.name}`] = item.name;
        queryObj.ExpressionAttributeValues[`:${item.name}`] = marshall(
          filters[item.name]
        );
      }
    });

    return queryObj;
  } catch (error) {
    throw error;
  }
}

/**
 * Retrieves all products matching a collectionId.
 *
 * @async
 * @param {string} collectionId - The collectionId of the product.
 * @param {Object} filters - Filter object for filtering results
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of product objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 *
 */
async function getProductsByCollectionId(collectionId, activityType, activityId, filters = {}, params = null) {
  logger.info("Get Products By CollectionId");
  try {
    if (!collectionId || !activityType || !activityId) {
      throw new Exception("collectionId, activityType, and activityId are required", { code: 400 });
    }

    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `product::${collectionId}::${activityType}::${activityId}` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Products: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting products", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves products matching the specified activityType.
 *
 * @async
 * @param {string} collectionId - The collectionId of the product.
 * @param {string} activityType - Type of activity to filter by.
 * @param {Object} filters - Filter object for filtering results
 * @param {Object} [params] - Optional parameters for pagination control.
 * @param {number} [params.limit] - Maximum number of items to return.
 * @param {string} [params.lastEvaluatedKey] - Key to resume pagination from.
 * @param {boolean} [params.paginated=true] - Whether to enable pagination.
 *
 * @returns {Promise<Object>} Query response containing:
 *   - items: Array of product objects
 *   - lastEvaluatedKey: Key for pagination continuation
 *   - count: Number of items returned
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getProductsByActivityType(
  collectionId,
  activityType,
  activityId,
  filters = {},
  params = null
) {
  logger.info("Get Products By Activity Type");
  try {
    if (!collectionId || !activityType || !activityId) {
      throw new Exception("collectionId, activityType, and activityId are required", { code: 400 });
    }

    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    
    let queryObj = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": { S: `product::${collectionId}::${activityType}::${activityId}` },
      },
    };

    if (Object.keys(filters).length > 0) {
      queryObj = addFilters(queryObj, filters);
    }

    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Products: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception("Error getting products", {
      code: 400,
      error: error,
    });
  }
}

/**
 * Retrieves a product by its productId.
 *
 * @async
 * @param {string} collectionId - The collectionId of the product.
 * @param {string} activityType - Type of activity.
 * @param {string} activityId - The activityId of the product.
 * @param {string} productId - The productId of the product.
 * @param {boolean} [fetchActivities] - Whether to fetch related activities.
 * @param {boolean} [fetchGeozones] - Whether to fetch related geozones.
 * @param {boolean} [fetchFacilities] - Whether to fetch related facilities.
 *
 * @returns {Promise<Object>} Product object
 *
 * @throws {Exception} With code 400 if database operation fails
 */
async function getProductByProductId(
  collectionId, 
  activityType, 
  activityId,
  productId, 
  fetchActivities = false, 
  fetchGeozones = false,
  fetchFacilities = false
) {
  logger.info("Get Product By ProductId");
  try {
    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("collectionId, activityType, activityId, and productId are required", { code: 400 });
    }

    let res = await getOne(
      `product::${collectionId}::${activityType}::${activityId}`,
      `${productId}::base`
    );

    // Batch get related items if requested
    let batchGetPromises = [];
    
    if (fetchActivities && res?.activities?.length) {
      logger.debug(`Fetching activities: ${JSON.stringify(res.activities, null, 2)}`);
      batchGetPromises.push(
        batchGetData(res.activities, REFERENCE_DATA_TABLE_NAME).then(data => {
          res.activities = data;
        })
      );
    }

    if (fetchGeozones && res?.geozones?.length) {
      logger.debug(`Fetching geozones: ${JSON.stringify(res.geozones, null, 2)}`);
      batchGetPromises.push(
        batchGetData(res.geozones, REFERENCE_DATA_TABLE_NAME).then(data => {
          res.geozones = data;
        })
      );
    }

    if (fetchFacilities && res?.facilities?.length) {
      logger.debug(`Fetching facilities: ${JSON.stringify(res.facilities, null, 2)}`);
      batchGetPromises.push(
        batchGetData(res.facilities, REFERENCE_DATA_TABLE_NAME).then(data => {
          res.facilities = data;
        })
      );
    }

    if (batchGetPromises.length > 0) {
      await Promise.all(batchGetPromises);
    }

    logger.debug(`Product: ${JSON.stringify(res, null, 2)}`);
    return res;
  } catch (error) {
    throw new Exception("Error getting product", { code: 400, error: error });
  }
}

/**
 * Processes incoming requests by handling batch operations and individual items.
 * Validates activityType and activityId parameters, falling back to body values if needed.
 *
 * @param {string} collectionId - CollectionId
 * @param {Object|Array} body - Request payload (single item or array of items)
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} activityType - Type of activity
 * @param {string} activityId - ID of the activity
 * @param {string} [productId=null] - Optional productId for PUT requests
 *
 * @returns {Array} Array of processed update requests
 */
async function parseRequest(collectionId, body, requestType, activityType, activityId, productId=null) {
  let updateRequests = [];
  // Check if the request is a batch request
  if (Array.isArray(body)) {
    for (let item of body) {
      updateRequests.push(
        await processItem(collectionId, item, requestType, activityType, activityId, productId)
      );
    }
  } else {
    // Single item request
    updateRequests.push(
      await processItem(collectionId, body, requestType, activityType, activityId, productId)
    );
  }

  return updateRequests;
}

/**
 * Processes individual items based on request type, creating appropriate key structures.
 * Handles PUT and POST requests differently, managing primary and sort keys accordingly.
 *
 * @param {string} collectionId - Product Collection ID
 * @param {Object} item - Item data to process
 * @param {string} requestType - Type of HTTP request ("PUT" or "POST")
 * @param {string} activityType - Type of activity
 * @param {number} activityId - ID of the activity
 * @param {string} [productId=null] - Optional productId for PUT requests
 *
 * @returns {Object} Processed item with key structure and data
 */
async function processItem(
  collectionId,
  item,
  requestType,
  activityType,
  activityId,
  productId = null
) {
  // Validate required parameters
  if (!collectionId) {
    throw new Error(`collectionId is required`, { code: 400 });
  }
  
  if (!activityType && !item.activityType) {
    throw new Error(`activityType is not specified in one of the requests.`, { code: 400 });
  }

  if (!activityId && !item.activityId) {
    throw new Error(`activityId is not specified in one of the requests.`, { code: 400 });
  }

  // activityType and activityId should be taken from params, but can be taken from item if it's a bulk update
  activityType = activityType ?? item?.activityType;
  activityId = activityId ?? item?.activityId;

  // Construct PK (same for both POST and PUT)
  const pk = `product::${collectionId}::${activityType}::${activityId}`;
  let sk = null;

  if (requestType == "PUT") {
    // For PUT, productId must be provided
    productId = productId || item.productId;
    if (!productId) {
      throw new Error(`productId is required for PUT requests`, { code: 400 });
    }

    // Construct SK from the provided productId
    sk = `${productId}::base`;

    // Remove items that can't be in a PUT request
    delete item.pk;
    delete item.sk;
    delete item.collectionId;
    delete item.activityType;
    delete item?.activitySubType;
    delete item.activityId;
    delete item.productId;
    delete item.identifier;
  } else if (requestType == "POST") {
    // For POST, productId should not be provided (auto-generated)
    if (item.productId) {
      throw new Error(
        "Can't specify productId in POST request; must be null to allow auto increment",
        { code: 400 }
      );
    }

    // If it's a retry attempt, remove these attributes from the item (if they exist)
    delete item?.productId;
    delete item?.creationDate;
    delete item?.lastUpdated;
    delete item?.version;

    // Increment the productId counter for this activity
    productId = await incrementCounter(pk, ["counter"]);

    // Construct SK from the new productId
    const sk = `${productId}::base`;

    // Generate globalId if not present
    if (!item.globalId) {
      item.globalId = crypto.randomUUID();
    }

    // Set the item properties
    item.pk = pk;
    item.sk = sk;
    item.schema = 'product';
    item.collectionId = collectionId;
    item.activityType = activityType;
    item.activityId = Number(activityId);
    item.productId = Number(productId);
    item.identifier = Number(productId);
    // Remove activitySubType if null or undefined
    if (item?.activitySubType === null || item?.activitySubType === undefined) {
      delete item.activitySubType;
    }
  }

  return {
    key: { pk: pk, sk: sk },
    data: item,
  };
}

async function getProducts(collectionId, activityType, activityId, seasonId = null, productId = null, options = {}) {
  logger.info('Get Product(s)');
  try {
    if (!collectionId || !activityType || !activityId) {
      throw 'Activity Collection ID, Activity Type and Activity Id are required';
    }
    if (!seasonId && productId) {
      throw 'Season ID is required if Product ID is provided';
    }
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `product::${collectionId}::${activityType}::${activityId}` },
      },
    };
    if (seasonId) {
      if (productId) {
        queryObj.KeyConditionExpression += ' AND sk = :sk';
        queryObj.ExpressionAttributeValues[':sk'] = { S: `${seasonId}::${productId}` };
      } else {
        queryObj.KeyConditionExpression += ' AND begins_with(sk, :sk)';
        queryObj.ExpressionAttributeValues[':sk'] = { S: `${seasonId}` };
      }
    }
    let res = await runQuery(queryObj);
    // If we want to also get the relevant policies, we will do a parallelized batch get
    // for each of the policies in the product.
    // Each product can have multiple policies, so we do a batch get where everything is fired off at once.
    if (options?.getPolicies && res?.items?.length) {
      let promises = [];
      res.items?.map((item => {
        promises.push(new Promise((resolve, reject) => {
          let policies = {
            bookingPolicy: [item?.bookingPolicy],
            changePolicy: [item?.changePolicy],
            partyPolicy: [item?.partyPolicy],
          };
          try {
            parallelizedBatchGetData(policies, TABLE_NAME).then(results => {
              for (const result of results) {
                item[result.key] = result.data;
              }
              resolve();
            });
          } catch (error) {
            reject(error);
          }
        }));
      }));
      await Promise.all(promises);
    }
    logger.info(`Products: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting products', { code: 400, error: error });
  }
}

async function getProductsByActivity(orcs, activityType, activityId) {
  logger.info('Get Products By Activity', orcs, activityType, activityId);
  try {
    if (!orcs || !activityType || !activityId) {
      throw 'ORCS, ActivityType and ActivityId are required';
    }
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `product::${orcs}::${activityType}::${activityId}` },
      },
    };
    const res = await runQuery(queryObj);
    logger.info(`Products: ${res?.items?.length} found.`);
    return res;
  } catch (error) {
    throw new Exception('Error getting products', { code: 400, error: error });
  }
}

async function getProductById(orcs, activityType, activityId, productId, fetchObj = null, startDate = null, endDate = null) {
  logger.info('Get Product By Id');
  try {
    let res = await getOne(`product::${orcs}::${activityType}::${activityId}`, `${productId}::properties`);
    let promiseObj = {};
    if (fetchObj?.fetchPolicies) {
      POLICY_TYPES.map(policyType => {
        const property = `${policyType}Policy`;
        promiseObj[property] = [{
          pk: `policy::${policyType}`,
          sk: `${res[property]}`,
        }];
      });
    }
    if (fetchObj?.fetchSchedule) {
      res['schedule'] = await getProductSchedule(orcs, activityType, activityId, productId, startDate, endDate);
    }
    if (Object.keys(promiseObj).length) {
      let results = await parallelizedBatchGetData(promiseObj, TABLE_NAME);
      for (const result of results) {
        res[result.key] = result.data;
      }
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting product', { code: 400, error: error });
  }
}

async function getProductSchedule(orcs, activityType, activityId, productId, startDate = null, endDate = null, getAll = false) {
  logger.info('Get Product Schedule');
  try {
    if (!orcs || !activityType || !activityId || !productId) {
      throw 'ORCS, ActivityType, ActivityId and Product Id are required';
    }

    // if getAll, get everything (should not be callable by API)
    // TODO: add a limit to the number of items returned depending on function caller
    let query = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
      ExpressionAttributeValues: {
        ':pk': { S: `product::${orcs}::${activityType}::${activityId}` },
        ':sk': { S: `${productId}` },
      },
    };

    // if not getAll, get from startDate to endDate
    if (!getAll) {

      // if no start date, set to today (UTC)
      if (!startDate) {
        startDate = getNow().toFormat('yyyy-LL-dd');
        endDate = buildDateTimeFromShortDate(startDate).plus(PRODUCT_DEFAULT_SCHEDULE_RANGE).toISODate();
      } else if (!endDate) {
        // otherwise if start date but no end date, get only start date
        endDate = startDate;
        query.KeyConditionExpression = 'pk = :pk AND sk = :sk';
        query.ExpressionAttributeValues[':sk'] = { S: `${productId}::${startDate}` };
      } else {
        // otherwise startDate and endDate provided; get range
        query.KeyConditionExpression = 'pk = :pk AND sk BETWEEN :skgt AND :sklt';
        query.ExpressionAttributeValues[':skgt'] = { S: `${productId}::${startDate}` };
        query.ExpressionAttributeValues[':sklt'] = { S: `${productId}::${endDate}` };
        // Can't have unused expression attribute values
        delete query.ExpressionAttributeValues[':sk'];
      }
    }

    const res = await runQuery(query);

    // Remove the default property item
    res.items = res.items.filter(item => item.sk !== `${productId}::properties`);

    return {
      startDate: startDate,
      endDate: endDate,
      dates: res.items || []
    };

  } catch (error) {
    throw new Exception('Error getting product schedule', { code: 400, error: error });
  }
}

async function getProductCalendarByStartDate(orcs, activityType, activityId, productId, startDate) {
  logger.info('Get Calendar By Start Date');
  try {
    if (!orcs || !activityType || !activityId || !productId || !startDate) {
      throw 'ORCS, ActivityType, ActivityId, ProductId and StartDate are all required';
    }
    return await getOne(
      `calendar::${orcs}::${activityType}::${activityId}`,
      `${productId}::${startDate}`,
    );
  } catch (error) {
    throw new Exception('Error getting calendar', { code: 400, error: error });
  }
}

async function buildSchedule(orcs, activityType, activityId, productId, startDate) {
  logger.info('Building Schedule');
  try {
    if (!orcs || !activityType || !activityId || !productId || !startDate) {
      throw 'ORCS, ActivityType, ActivityId, ProductId and StartDate are all required';
    }

    // Get the default product
    const product = await getProductById(orcs, activityType, activityId, productId);
    // Get the calendar for the product
    const calendar = await getProductCalendarByStartDate(orcs, activityType, activityId, productId, startDate);

    if (!product || !calendar) {
      throw 'Product or Calendar not found';
    }

    // Build the schedule
    // For now, we will object merge the product and calendar to get product items for each day
    // We can also delete some default properties from the daily product items to reduce size.
    // TODO: improve this logic - object merge seems insecure/unreliable/not robust

    // For a first pass, we don't want to make any change to dates that are in the past.
    // This is because dates in the past should be a record of what was available at that time.
    const today = getNow();
    if (today > buildDateTimeFromShortDate(startDate)) {
      startDate = today.toFormat('yyyy-LL-dd');
    }

    // We need to pull all the items in  the existing schedule. If the item is not in the new schedule, AND it is after today, we will delete it.
    let existingSchedule = await getProductSchedule(orcs, activityType, activityId, productId, null, null, true);
    existingSchedule = existingSchedule.dates.filter(item => item.date >= startDate);

    // Build date range array
    let dates = buildDateRange(startDate, calendar.endDate);

    // Build product schedule
    let productSchedule = [];
    for (const date of dates) {
      // build new sk
      let dailySchedule = { ...product };
      const oldSk = dailySchedule.sk;
      dailySchedule.sk = `${oldSk.replace('properties', date)}`;
      dailySchedule['date'] = date;
      if (calendar.schedule[date]) {
        dailySchedule = { ...dailySchedule, ...calendar.schedule[date] };
        // delete some default properties
      }
      for (const prop of PRODUCT_DEFAULT_PROPERTY_NAMES) {
        delete dailySchedule[prop];
      }
      // If permit is required, add to product schedule
      if (dailySchedule.isPermitRequired) {
        productSchedule.push({
          data: dailySchedule
        });
        // remove from existing schedule to keep track of what needs to be deleted.
        let index = existingSchedule.indexOf(existingSchedule.find(item => item.sk === dailySchedule.sk));
        if (index > -1) {
          existingSchedule.splice(index, 1);
        }
      }
    }

    // Batch write the product schedule
    if (productSchedule.length) {
      let newScheduleItems = await quickApiPutHandler(TABLE_NAME, productSchedule, PRODUCT_DAILY_PROPERTIES_CONFIG);
      await batchTransactData(newScheduleItems);
      // if successful, delete preexisting products that no longer exist in the schedule
      // If a product is in productSchedule, it was removed from existingSchedule.
      if (existingSchedule.length) {
        await deleteOldProducts(existingSchedule);
      }
    }

    return {
      updated: productSchedule.length,
      deleted: existingSchedule.length,
    };

  } catch (error) {
    throw new Exception('Error building schedule', { code: 400, error: error });
  }
}

async function deleteOldProducts(productsToDelete) {
  logger.info('Delete products');
  try {
    if (!productsToDelete.length) {
      return;
    }

    let itemList = [];

    // Batch delete
    for (const item of productsToDelete) {
      itemList.push({
        action: 'Delete',
        data: {
          TableName: TABLE_NAME,
          Key: {
            pk: { S: item.pk },
            sk: { S: item.sk },
          },
          ConditionExpression: 'attribute_exists(pk)',
        },
      });
    }

    await batchTransactData(itemList);

    return;
  } catch (error) {
    throw new Exception('Error deleting future products', { code: 400, error: error });
  }
}

module.exports = {
  buildSchedule,
  getProducts,
  getProductsByActivity,
  getProductById,
  getProductsByCollectionId,
  getProductsByActivityType,
  getProductByProductId,
  parseRequest,
};
