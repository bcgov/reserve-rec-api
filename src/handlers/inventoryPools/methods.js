const { logger, Exception, buildDateRange } = require('/opt/base');
const { fetchProductDates } = require('../productDates/methods');
const { REFERENCE_DATA_TABLE_NAME, runQuery, batchTransactData, marshall } = require("/opt/dynamodb");

async function fetchInventoryPoolsOnDate(props) {
  try {
    const { collectionId, activityType, activityId, productId, date, facilityType = null, facilityId = null, assetType = null, assetId = null, inventoryId = null, limit = null } = props;

    logger.debug(`Fetching InventoryPools for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} on date ${date}`);

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Missing required parameters: collectionId, activityType, activityId, productId");
    }

    // InventoryPools pk: "inventoryPool::\<collectionId>::\<activityType>::\<activityId>::\<productId>::\<date>"
    let query = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `inventoryPool::${collectionId}::${activityType}::${activityId}::${productId}::${date}` }
      }
    };


    // InventoryPools sk:
    if (facilityType) {
      logger.debug(`Adding asset filters to InventoryPool query for facilityType: ${facilityType}, facilityId: ${facilityId}, assetType: ${assetType}, assetId: ${assetId}`);

      // Systematically add filters in order of facilityType, facilityId, assetType, assetId
      let filters = [facilityType, facilityId, assetType, assetId, inventoryId];

      // Drop all filters including and beyond the first null filter
      const firstNullIndex = filters.findIndex(filter => filter === null);
      if (firstNullIndex !== -1) {
        filters = filters.slice(0, firstNullIndex);
      }

      const filterString = `asset::${collectionId}::` + filters.map(filter => `${filter}`).join('::');

      query.KeyConditionExpression += ' AND begins_with(sk, :skPrefix)';
      query.ExpressionAttributeValues[':skPrefix'] = { S: filterString };
    }

    // Fetch InventoryPools

    const result = await runQuery(query, limit);

    return result?.items || [];

  } catch (error) {
    logger.error("Error fetching InventoryPools", error);
    throw error;
  }

}

async function fetchInventoryPoolsForDateRange(props) {
  try {
    const { collectionId, activityType, activityId, productId, startDate, endDate, facilityType = null, facilityId = null, assetType = null, assetId = null, inventoryId = null } = props;

    logger.debug(`Fetching InventoryPools for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} from ${startDate} to ${endDate}`);

    if (!collectionId || !activityType || !activityId || !productId || !startDate || !endDate) {
      throw new Exception("Missing required parameters: collectionId, activityType, activityId, productId, startDate, endDate");
    }

    // Build list of dates to query
    const dates = buildDateRange(startDate, endDate);
    let allInventoryPools = [];

    // Fetch inventory pools for each date in the range
    for (const date of dates) {
      try {
        const inventoryPools = await fetchInventoryPoolsOnDate({ 
          collectionId, 
          activityType, 
          activityId, 
          productId, 
          date,
          facilityType,
          facilityId,
          assetType,
          assetId,
          inventoryId
        });
        allInventoryPools = allInventoryPools.concat(inventoryPools);
      } catch (error) {
        logger.warn(`Error fetching InventoryPools for date ${date}:`, error);
        // Continue with next date if one fails
      }
    }

    logger.debug(`Fetched ${allInventoryPools.length} InventoryPool records from ${startDate} to ${endDate}`);

    return allInventoryPools;

  } catch (error) {
    logger.error("Error fetching InventoryPools for date range", error);
    throw error;
  }
}


async function initializeInventoryPools(props) {
  try {
    const {
      collectionId,
      activityType,
      activityId,
      productId,
      startDate,
      endDate,
      bypassDiscoveryRules = true
    } = props;

    logger.debug(`Initializing InventoryPools for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} from ${startDate} to ${endDate}`);


    // === Validate that the ProductDates exist for the given date range ===
    const productDates = await fetchProductDates({ collectionId, activityType, activityId, productId, startDate, endDate, bypassDiscoveryRules });

    logger.debug(`Fetched ${productDates?.length} product dates for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} from ${startDate} to ${endDate}`);

    // === For each product date, create InventoryPools - one per Asset ===

    let inventoryPoolsToCreate = [];
    let successes = [];
    let failures = [];

    for (const productDate of productDates) {

      // get the assetList from the productDate
      const assetList = productDate?.assetList || [];

      // If there are no assets for this product date, we cannot create inventory pools, so we will log a warning and skip it
      if (assetList.length === 0) {
        logger.warn(`No assets found for productDate ${productDate.id}, skipping InventoryPool creation for this date`);
        failures.push({
          date: productDate?.date,
          productDate: productDate,
          reason: 'No assets found for this product date',
        });
        continue;
      }

      // Create an InventoryPool for each Asset in the assetList

      for (const asset of assetList) {
        try {
          let inventoryPoolRecord = {
            pk: `inventoryPool::${collectionId}::${activityType}::${activityId}::${productId}::${productDate.date}`,
            sk: `${asset.primaryKey.pk}::${asset.primaryKey.sk}`,
            schema: "inventoryPool",
            date: productDate.date,
            assetRef: asset,
            allocationType: asset?.allocationType,
            productDateRef: {
              pk: productDate.pk,
              sk: productDate.sk,
            },
            productDateVersion: productDate.version,
            capacity: asset.quantity,
            availability: asset.quantity,
            availabilityEstimationPattern: productDate?.availabilityEstimationPattern || null,
          };

          inventoryPoolsToCreate.push(inventoryPoolRecord);
          successes.push({
            date: productDate?.date,
            asset: asset,
          });

        } catch (error) {
          logger.error("Error initializing InventoryPools", error);
          failures.push({
            date: productDate?.date,
            productDate: productDate,
            reason: `Error initializing InventoryPools for this product date ${productDate?.date}: ${error.message}`,
          });
        }
      }
    }

    logger.info(`Finished initializing InventoryPools. Successfully prepared ${inventoryPoolsToCreate.length} InventoryPool records for ${successes.length} product date/assets. Failed to prepare InventoryPool records for ${failures.length} product dates/assets.`);

    return [inventoryPoolsToCreate, successes, failures];

  } catch (error) {
    logger.error("Error initializing InventoryPools", error);
    throw error;
  }
}

async function deleteInventoryPools(props) {
  try {
    const { collectionId, activityType, activityId, productId, startDate, endDate } = props;
    props['queryTime'] = props['queryTime'] || new Date().toISOString();
    props['bypassDiscoveryRules'] = true;

    logger.debug(`Deleting InventoryPools for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} from ${startDate} to ${endDate}`);

    // We can infer the partition key for all InventoryPool records based on the collectionId, activityType, activityId, productId, and date range. This allows us to query for all InventoryPool records in the date range and delete them in batches.

    // Unfortunately, we cannot just batch delete based on partition key because DELETE requires both the partition key and sort key, and the sort key includes the asset primary key and unit id, which we do not have. Therefore, we need to first query for all InventoryPool records in the date range to get their sort keys, and then batch delete them.

    const dates = buildDateRange(startDate, endDate);

    let inventoryPoolsToDelete = [];
    for (const date of dates) {
      const inventoryPools = await fetchInventoryPoolsOnDate({ collectionId, activityType, activityId, productId, date });
      inventoryPoolsToDelete = inventoryPoolsToDelete.concat(inventoryPools);
    }

    logger.debug(`Deleting ${inventoryPoolsToDelete.length} InventoryPool records from product ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);

    // Batch delete them from DynamoDB

    const deleteRequests = inventoryPoolsToDelete.map(inventoryPool => ({
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: {
        pk: {S: inventoryPool.pk},
        sk: {S: inventoryPool.sk},
      }
    }));

    await batchTransactData(deleteRequests, 'Delete');

    logger.info(`Successfully deleted ${inventoryPoolsToDelete.length} InventoryPool records for product ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);

    return inventoryPoolsToDelete.length;

  } catch (error) {
    logger.error("Error deleting InventoryPools", error);
    throw error;
  }
}


/**
 * Applies new asset quantities to the InventoryPools of the given dates.
 *
 * Capacity is set to the new quantity, and availability is recalculated so that units
 * already taken (capacity - availability on the existing pool) stay taken.
 *
 * @param {Object} props
 * @param {string} props.collectionId
 * @param {string} props.activityType
 * @param {string|number} props.activityId
 * @param {string|number} props.productId
 * @param {Array<string>} props.dates - dates whose pools should be updated
 * @param {Array} props.assetList - the new assetList (quantity per asset)
 *
 * @returns {number} the number of InventoryPools updated
 */
async function syncCapacityToInventoryPools(props) {
  const { collectionId, activityType, activityId, productId, dates = [], assetList = [] } = props;

  if (dates.length === 0 || assetList.length === 0) {
    return 0;
  }

  const quantityBySk = new Map(
    assetList
      .filter((asset) => asset?.primaryKey?.pk && asset?.primaryKey?.sk)
      .map((asset) => [`${asset.primaryKey.pk}::${asset.primaryKey.sk}`, asset.quantity ?? 0])
  );

  let putItems = [];

  // ponytail: one query per date - InventoryPool pk includes the date, so there is no
  // single-query alternative. Same pattern as deleteInventoryPools.
  for (const date of dates) {
    const pools = await fetchInventoryPoolsOnDate({ collectionId, activityType, activityId, productId, date });

    for (const pool of pools) {
      if (!quantityBySk.has(pool.sk)) {
        continue;
      }

      const newCapacity = quantityBySk.get(pool.sk);
      const taken = Math.max(0, (pool.capacity ?? 0) - (pool.availability ?? 0));
      const newAvailability = Math.max(0, newCapacity - taken);

      if (newCapacity < taken) {
        logger.warn(`InventoryPool ${pool.pk}::${pool.sk} is oversold: new capacity ${newCapacity} is below ${taken} already taken`);
      }

      putItems.push({
        TableName: REFERENCE_DATA_TABLE_NAME,
        Item: marshall(
          { ...pool, capacity: newCapacity, availability: newAvailability, lastUpdated: new Date().toISOString() },
          { removeUndefinedValues: true }
        )
      });
    }
  }

  if (putItems.length === 0) {
    return 0;
  }

  await batchTransactData(putItems, 'Put');

  logger.info(`Synced capacity to ${putItems.length} InventoryPools for Product ${productId}`);

  return putItems.length;
}

module.exports = {
  fetchInventoryPoolsOnDate,
  fetchInventoryPoolsForDateRange,
  syncCapacityToInventoryPools,
  initializeInventoryPools,
  deleteInventoryPools,
};
