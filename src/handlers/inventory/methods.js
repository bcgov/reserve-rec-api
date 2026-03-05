const { logger, buildDateRange, Exception } = require('/opt/base');
const { fetchProductDates } = require('../productDates/methods');
const { REFERENCE_DATA_TABLE_NAME, runQuery, batchTransactData } = require("/opt/dynamodb");
const { INVENTORY_ALLOCATION_STATUSES } = require('./configs');

async function fetchInventoryOnDate(props) {
  try {
    const { collectionId, activityType, activityId, productId, date, facilityType = null, facilityId = null, assetType = null, assetId = null, inventoryId = null, limit = null, allocationStatus = null } = props;

    logger.debug(`Fetching inventory for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} on date ${date}`);

    if (!collectionId || !activityType || !activityId || !productId) {
      throw new Exception("Missing required parameters: collectionId, activityType, activityId, productId");
    }

    let query = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `inventory::${collectionId}::${activityType}::${activityId}::${productId}::${date}` }
      }
    };

    if (facilityType) {
      logger.debug(`Adding asset filters to inventory query for facilityType: ${facilityType}, facilityId: ${facilityId}, assetType: ${assetType}, assetId: ${assetId}`);

      // Systematically add filters in order of facilityType, facilityId, assetType, assetId
      let filters = [facilityType, facilityId, assetType, assetId, inventoryId];

      // Drop all filters including and beyond the first null filter
      const firstNullIndex = filters.findIndex(filter => filter === null);
      if (firstNullIndex !== -1) {
        filters = filters.slice(0, firstNullIndex);
      }

      const filterString = filters.map(filter => `${filter}`).join('::');

      query.KeyConditionExpression += ' AND begins_with(sk, :skPrefix)';
      query.ExpressionAttributeValues[':skPrefix'] = { S: `asset::${collectionId}::${filterString}` };
    }

    if (allocationStatus) {
      logger.debug(`Adding allocationStatus filter to inventory query: ${allocationStatus}`);
      query.FilterExpression = 'allocationStatus = :allocationStatus';
      query.ExpressionAttributeValues[':allocationStatus'] = { S: allocationStatus };
    }

    // Fetch inventory

    const result = await runQuery(query, limit);

    return result?.items || [];

  } catch (error) {
    logger.error("Error fetching inventory", error);
    throw error;
  }
}

async function allocateInventoryToUser(props) {
  try {
    const { collectionId, activityType, activityId, productId, date, facilityType = null, facilityId = null, assetType = null, assetId = null, limit = null, allocationStatus = null } = props;
  } catch (error) {
    logger.error("Error allocating inventory", error);
    throw error;
  }
}

async function initializeInventory(collectionId, activityType, activityId, productId, startDate, endDate) {
  try {
    logger.debug(`Initializing inventory for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} from ${startDate} to ${endDate}`);

    // Fetch all ProductDates in range.
    const props = {
      collectionId: collectionId,
      activityType: activityType,
      activityId: activityId,
      productId: productId,
      startDate: startDate,
      endDate: endDate,
      bypassDiscoveryRules: true
    };
    const productDates = await fetchProductDates(props);

    logger.debug(`Fetched ${productDates?.items?.length} product dates for initialization`);

    // For each ProductDate, inspect the assetList and create an Inventory record for each asset.

    let inventoryToCreate = [];
    let successes = [];
    let failures = [];
    for (const productDate of productDates?.items) {
      // get the assetList from the productDate
      const assetList = productDate?.assetList || [];

      if (assetList.length === 0) {
        logger.warn(`No assets found for productDate ${productDate.id}, skipping inventory creation for this date`);
        failures.push({
          date: productDate?.date,
          productDate: productDate,
          reason: 'No assets found for this product date',
        });
        continue;
      }

      for (const asset of assetList) {
        // Create an Inventory record for this asset and date. If the quantity is greater than 1, we will create multiple Inventory records for the same flex asset.
        try {
          let unitId = 1;

          while (unitId <= asset.quantity) {
            let inventoryRecord = {
              pk: `inventory::${collectionId}::${activityType}::${activityId}::${productId}::${productDate.date}`,
              sk: `${asset.primaryKey.pk}::${asset.primaryKey.sk}::${unitId}`,
              schema: "inventory",
              inventoryId: unitId,
              date: productDate.date,
              allocationType: asset?.allocationType,
              assetRef: asset,
              productDateRef: {
                pk: productDate.pk,
                sk: productDate.sk,
              },
              productDateVersion: productDate.version,
              allocationStatus: INVENTORY_ALLOCATION_STATUSES.AVAILABLE,
            };
            inventoryToCreate.push(inventoryRecord);
            successes.push(productDate.date);
            unitId++;
          }
        } catch (error) {
          logger.error(`Error creating inventory record for asset ${asset?.pk} on date ${productDate?.date}`, error);
          failures.push({
            date: productDate?.date,
            asset: asset,
            reason: `Error creating inventory record: ${error.message}`,
          });
        }
      }
    }

    logger.info(`Finished initializing inventory. Successfully prepared ${inventoryToCreate.length} inventory records for ${successes.length} product dates. Failed to prepare inventory records for ${failures.length} product dates.`);

    return [inventoryToCreate, successes, failures];

  } catch (error) {
    logger.error("Error initializing inventory", error);
    throw error;
  }
}

async function deleteInventory(props) {
  try {
    const { collectionId, activityType, activityId, productId, startDate, endDate } = props;
    props['queryTime'] = props['queryTime'] || new Date().toISOString();
    props['bypassDiscoveryRules'] = true;

    logger.debug(`Deleting inventory for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId} from ${startDate} to ${endDate}`);

    // We can infer the partition key for all inventory records based on the collectionId, activityType, activityId, productId, and date range. This allows us to query for all inventory records in the date range and delete them in batches.

    // Unfortunately, we cannot just batch delete based on partition key because DELETE requires both the partition key and sort key, and the sort key includes the asset primary key and unit id, which we do not have. Therefore, we need to first query for all inventory records in the date range to get their sort keys, and then batch delete them.

    const dates = buildDateRange(startDate, endDate);

    let inventoryToDelete = [];
    for (const date of dates) {
      const inventoryRecords = await fetchInventoryOnDate({
        collectionId,
        activityType,
        activityId,
        productId,
        date
      });
      inventoryToDelete = inventoryToDelete.concat(inventoryRecords);
    }

    logger.debug(`Deleting ${inventoryToDelete.length} inventory records from product ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);

    // Batch delete them from DynamoDB.

    const deleteRequests = inventoryToDelete.map(record => ({
      TableName: REFERENCE_DATA_TABLE_NAME,
      Key: {
        pk: {S: record.pk},
        sk: {S: record.sk},
      }
    }));

    await batchTransactData(deleteRequests, 'Delete');

    logger.info(`Successfully deleted ${inventoryToDelete.length} inventory records for product ${collectionId}::${activityType}::${activityId}::${productId} from ${startDate} to ${endDate}`);

    return inventoryToDelete.length;

    // Fetch all ProductDates in range.
  } catch (error) {
    logger.error("Error deleting inventory", error);
    throw error;
  }
}

module.exports = {
  deleteInventory,
  fetchInventoryOnDate,
  initializeInventory,
};