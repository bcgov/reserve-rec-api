
const { TABLE_NAME, batchTransactData, runQuery, getOne, parallelizedBatchGetData } = require('/opt/dynamodb');
const { Exception, buildDateRange, buildDateTimeFromShortDate, getNow, logger } = require('/opt/base');
const { POLICY_TYPES } = require('/opt/policies/configs');
const { PRODUCT_DAILY_PROPERTIES_CONFIG, PRODUCT_DEFAULT_PROPERTY_NAMES, PRODUCT_DEFAULT_SCHEDULE_RANGE } = require('/opt/products/configs');
const { quickApiPutHandler } = require('/opt/data-utils');

async function getProducts(acCollectionId, activityType, activityId, seasonId = null, productId = null, options = {}) {
  logger.info('Get Product(s)');
  try {
    if (!acCollectionId || !activityType || !activityId) {
      throw 'Activity Collection ID, Activity Type and Activity Id are required';
    }
    if (!seasonId && productId) {
      throw 'Season ID is required if Product ID is provided';
    }
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `product::${acCollectionId}::${activityType}::${activityId}` },
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
};