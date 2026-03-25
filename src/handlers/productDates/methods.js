const { logger, Exception } = require("/opt/base");
const { getOne, batchTransactData, runQuery, REFERENCE_DATA_TABLE_NAME, marshall } = require("/opt/dynamodb");
const { getProductById } = require("../products/methods");
const { buildDateRange } = require("/opt/base");
const { DateTime } = require("luxon");
const { formatProjectionsForQuery, resolveTemporalAnchor, resolveTemporalWindow } = require("../../common/data-utils");

async function fetchProductDates(props) {
  try {
    const {
      queryTime = new Date().getTime(),
      collectionId,
      activityType,
      activityId,
      productId,
      startDate,
      endDate,
      bypassDiscoveryRules = false,
      projectionFields = null
    } = props;

    const productDatePK = `productDate::${collectionId}::${activityType}::${activityId}::${productId}`;

    // create query to fetch ProductDates within the specified date range
    let query = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :startDate AND :endDate',
      ExpressionAttributeValues: {
        ':pk': { S: productDatePK },
        ':startDate': { S: startDate },
        ':endDate': { S: endDate }
      }
    };

    if (!bypassDiscoveryRules) {
      query.FilterExpression = 'reservationContext.isDiscoverable = :isDiscoverable AND reservationContext.temporalWindows.discoveryWindow.#open <= :currentDateTime AND reservationContext.temporalWindows.discoveryWindow.#close >= :currentDateTime';
      query.ExpressionAttributeNames = {
        '#open': 'open',
        '#close': 'close'
      };
      query.ExpressionAttributeValues[':isDiscoverable'] = { BOOL: true };
      query.ExpressionAttributeValues[':currentDateTime'] = { N: String(queryTime) };
    }

    if (projectionFields) {
      const projectionsMap = formatProjectionsForQuery(projectionFields);
      query.ExpressionAttributeNames = { ...query.ExpressionAttributeNames, ...projectionsMap };
      query.ProjectionExpression = Object.keys(projectionsMap).join(', ');
    }

    logger.debug(`Querying ProductDates for Product ${productId} with activity '${activityType} ${activityId}' between dates ${startDate} and ${endDate}. Bypass discovery rules: ${bypassDiscoveryRules}`, { query });

    const result = await runQuery(query);

    return result;

  } catch (error) {
    logger.error("Error in fetchProductDates", error);
    throw error;
  }
}

async function initializeProductDates(collectionId, activityType, activityId, productId, startDate = null, endDate = null) {
  try {

    // Fetch the parent product
    const product = await getProductById(collectionId, activityType, activityId, productId);

    if (!product) {
      throw new Exception(`Product not found for collectionId: ${collectionId}, activityType: ${activityType}, activityId: ${activityId}, productId: ${productId}`, { code: 404 });
    }

    // Ensure correct date range is being used. Default to Product rangeStart and rangeEnd if startDate and endDate are not provided

    let effectiveStartDate = startDate || product?.rangeStart;
    let effectiveEndDate = endDate || product?.rangeEnd;

    // effectiveStartDate is mandatory, but effectiveEndDate is optional (if not provided, ProductDates will be created for a single date rather than a date range)

    if (!effectiveStartDate) {
      throw new Exception(`Start date is required for ProductDates initialization`, { code: 400 });
    }

    if (!effectiveEndDate) {
      effectiveEndDate = effectiveStartDate;
    }

    // Get the policies associated with the Product

    let reservationPolicy = await getOne(product?.reservationPolicy?.primaryKey?.pk, product?.reservationPolicy?.primaryKey?.sk);
    let partyPolicy = await getOne(product?.partyPolicy?.primaryKey?.pk, product?.partyPolicy?.primaryKey?.sk);
    let changePolicy = await getOne(product?.changePolicy?.primaryKey?.pk, product?.changePolicy?.primaryKey?.sk);
    let feePolicy = await getOne(product?.feePolicy?.primaryKey?.pk, product?.feePolicy?.primaryKey?.sk);

    // initialize array of ProductDates

    let productDates = [];

    // Build the date range for the ProductDates to be created for

    const dates = buildDateRange(effectiveStartDate, effectiveEndDate);

    // Loop through the date range and create a ProductDate for each date

    for (const date of dates) {

      // Initialize availability signal for the ProductDate

      /**
       * === Note - AvailabilitySignals are likely no longer needed after this change
       * https://github.com/bcgov/reserve-rec-api/pull/331
       * Reasoning: https://github.com/bcgov/reserve-rec-api/issues/326
       *  */
      // let availabilitySignal = initializeAvailabilitySignal(product, date);
      // availabilitySignals.push(availabilitySignal);

      // Initialize the ProductDate

      let productDate = {
        pk: `productDate::${collectionId}::${activityType}::${activityId}::${productId}`,
        sk: date,
        collectionId: collectionId,
        schema: 'productDate',
        activityType: activityType,
        activityId: activityId,
        productId: productId,
        date: date,
        displayName: `${product?.displayName} - ${date}`,
        availabilityEstimationPattern: product?.availabilityEstimationPattern || null,
        // No need to store allDatesBookedIntervalIds for now - there will be none for DUP.
        // allDatesBookedIntervalIds: getAllDatesBookedIntervalIds(product, date),
        assetList: product?.assetList || [],
        reservationPolicy: reservationPolicy?.productDateRules,
        reservationContext: resolveProductDateReservationContext(product, date, reservationPolicy),
        partyPolicy: partyPolicy,
        changePolicy: changePolicy,
        feePolicy: feePolicy,
        // No need to store feeContext for now - DUP is free.
        // feeContext: resolveProductDateFeeContext(product, date, feePolicy)
      };
      productDates.push(productDate);
    }

    logger.debug(`Initialized ${productDates?.length} ProductDates for Product ${productId} with activity '${activityType} ${activityId}' between dates ${effectiveStartDate} and ${effectiveEndDate}`);


    return productDates;

  } catch (error) {
    logger.error("Error in initializeProductDates", error);
    throw error;
  }
}

function initializeAvailabilitySignal(product, date) {
  let availabilitySignal = {
    pk: `availabilitySignal::${product.collectionId}::${product.activityType}::${product.activityId}::${product.productId}`,
    sk: date,
    schema: "availabilitySignal",
    value: "high", // this will be updated by the availability signal process
    availabilityEstimationPattern: product?.availabilityEstimationPattern,
    expiry: getExpiryForAvailabilitySignal(date, product?.timezone || 'America/Vancouver') // set expiry based on the ProductDate date
  };
  return availabilitySignal;
}

function getExpiryForAvailabilitySignal(date, timezone = 'UTC') {
  // Availability signals should expire when the ProductDate date has passed. For simplicity, this will be midnight on the ProductDate date.
  const productDate = DateTime.fromISO(date, { zone: timezone });
  const expiryDate = productDate.endOf('day'); // set expiry to the end of the ProductDate day (i.e. when the date has passed)
  return expiryDate.toISO(); // return expiry as a Unix timestamp
}

function getAllDatesBookedIntervalIds(product, date) {
  let ids = [];
  // for every AllDatesBookedInterval in the Product, check if the date falls within the interval. If so, add the interval id to the ProductDate's allDatesBookedIntervalIds array
  for (const interval of product?.allDatesBookedIntervals || []) {
    if (interval.startDate <= date && interval.endDate >= date) {
      ids.push(interval?.id);
    }
  }
  return ids;
}

function resolveProductDateReservationContext(product, date, reservationPolicy) {
  const productDateReservationPolicy = reservationPolicy?.productDateRules;
  let temporalAnchors = productDateReservationPolicy?.temporalAnchors || {};
  let resolvedTemporalAnchors = {};
  let temporalWindows = productDateReservationPolicy?.temporalWindows || {};
  let resolvedTemporalWindows = {};
  let refStore = {
    productDate: date
  };

  for (const anchor of temporalAnchors) {
    resolvedTemporalAnchors[anchor?.id] = resolveTemporalAnchor(anchor, product?.timezone, refStore).millis;
  }

  for (const window of temporalWindows) {
    resolvedTemporalWindows[window?.id] = resolveTemporalWindow(window, product?.timezone, refStore);
  }
  const policy = {
    isDiscoverable: productDateReservationPolicy?.isDiscoverable || true,
    isReservable: productDateReservationPolicy?.isReservable || true,
    minDailyInventory: productDateReservationPolicy?.minDailyInventory || 1,
    maxDailyInventory: productDateReservationPolicy?.maxDailyInventory || 1,
    temporalWindows: resolvedTemporalWindows
  };
  return policy;
}

async function deleteProductDates(collectionId, activityType, activityId, productId, startDate = null, endDate = null) {

  try {
    // if date range not provided, try to pull it from the Product
    if (!startDate) {
      const product = await getProductById(collectionId, activityType, activityId, productId);
      startDate = startDate || product?.rangeStart;
      endDate = endDate || product?.rangeEnd;
    }

    if (!startDate) {
      throw new Exception(`Start date and end date are required to delete ProductDates. If not provided in the request, they will be pulled from the Product. Please ensure that the Product has rangeStart and rangeEnd properties if not providing startDate and endDate in the request.`, { code: 400 });
    }

    // create bulk delete requests

    if (!endDate) {
      endDate = startDate;
    }

    let deleteItems = [];
    const dates = buildDateRange(startDate, endDate);

    let productDatePK = `productDate::${collectionId}::${activityType}::${activityId}::${productId}`;

    // === Note: we no longer also have to delete availability signals

    for (const date of dates) {
      deleteItems.push({
        TableName: REFERENCE_DATA_TABLE_NAME,
        Key: {
          pk: { S: productDatePK },
          sk: { S: date }
        }
      });
    }

    logger.info(`Deleting ${deleteItems.length} ProductDate items for Product ${productId} with activity '${activityType} ${activityId}' between dates ${startDate} and ${endDate}`);

    await batchTransactData(deleteItems, 'Delete');

    logger.info(`Successfully deleted ${deleteItems.length} ProductDate items for Product ${productId} with activity '${activityType} ${activityId}' between dates ${startDate} and ${endDate}`);
    return deleteItems.length;

  } catch (error) {
    logger.error("Error in deleteProductDates", error);
    throw error;
  }

}

module.exports = {
  deleteProductDates,
  fetchProductDates,
  initializeProductDates,
};