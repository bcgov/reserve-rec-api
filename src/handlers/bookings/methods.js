const crypto = require("crypto");
const {
  getOneByGlobalId,
  marshall,
  runQuery,
  getOne,
  REFERENCE_DATA_TABLE_NAME,
  TRANSACTIONAL_DATA_TABLE_NAME,
  SPARSE_GSI1_NAME,
  USERID_INDEX_NAME,
  USERID_PROPERTY_NAME,
} = require("/opt/dynamodb");
const { snsPublishCommand, snsPublishSend } = require("/opt/sns");
const { Exception, logger } = require("/opt/base");
const { sendConfirmationEmail, sendCancellationEmail } = require("../../../lib/handlers/emailDispatch/utils");
const {
  getActivityByActivityId,
  getActivitiesByCollectionId,
} = require("../activities/methods");
const { getAndAttachNestedProperties, quickApiPutHandler, quickApiUpdateHandler } = require("../../common/data-utils");
const {
  DEFAULT_PRICE,
  DEFAULT_TRANSACTION_FEE_PERCENT,
  DEFAULT_TAX_PERCENT,
  BOOKING_STATUS_ENUMS,
} = require("../../common/data-constants");
const { PUBLIC_PRODUCTDATE_PROJECTIONS } = require("../productDates/configs");
const { fetchProductDates } = require("../productDates/methods");
const { DateTime } = require("luxon");
const { BOOKING_PUT_CONFIG, BOOKINGDATES_PUT_CONFIG, BOOKING_UPDATE_CONFIG } = require("./configs");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { getUserInfoByUserName, getUserInfoBySub } = require("../users/methods");

const DEFAULT_SESSION_LENGTH = 15; // in minutes

/**
 * Resolve the booking owner's identity (firstName, lastName, email, phone) from
 * the verified Cognito user pool, given their immutable `sub`. The booking row
 * must store these from Cognito — never from the request body — so that a
 * client cannot put another user's name/email on their booking (Ref #480).
 *
 * Address fields are intentionally not sourced here: Cognito does not reliably
 * carry address attributes for BCSC users, so the booking flow accepts those
 * from the request body. Identity (name + contact) lives in Cognito.
 *
 * @param {string} sub - Cognito sub of the authenticated user
 * @returns {Promise<{firstName:string,lastName:string,email:string,mobilePhone:string}|null>}
 */
async function resolveAuthenticatedOccupantIdentity(sub) {
  if (!sub) return null;  try {
    const userInfo = await getUserInfoBySub(sub, 'public');
    const attrs = userInfo?.Attributes || [];
    const get = (n) => attrs.find(a => a.Name === n)?.Value || '';
    return {
      firstName: get('given_name'),
      lastName: get('family_name'),
      email: get('email'),
      mobilePhone: get('custom:mobilePhone') || get('phone_number'),
    };
  } catch (error) {
    logger.error('Failed to resolve occupant identity from Cognito', { sub, error: error?.message });
    throw error;
  }
}

/**
 * Helper: Get start of day in UTC for a date string
 * @param {string} dateString - ISO date string (e.g., "2025-12-12")
 * @returns {Date} Date object set to midnight UTC
 */
function getStartOfDayUTC(dateString) {
  const date = new Date(dateString + 'T00:00:00.000Z');
  return date;
}

/**
 * Helper: Add days to a date
 * @param {Date} date - Base date
 * @param {number} days - Number of days to add
 * @returns {Date} New date with days added
 */
function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Helper: Add minutes to a date
 * @param {Date} date - Base date
 * @param {number} minutes - Number of minutes to add
 * @returns {Date} New date with minutes added
 */
function addMinutes(date, minutes) {
  const result = new Date(date);
  result.setUTCMinutes(result.getUTCMinutes() + minutes);
  return result;
}

/**
 * Helper: Add years to a date
 * @param {Date} date - Base date
 * @param {number} years - Number of years to add
 * @returns {Date} New date with years added
 */
function addYears(date, years) {
  const result = new Date(date);
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

/**
 * Helper: Get ISO date string (YYYY-MM-DD) from Date object
 * @param {Date} date - Date object
 * @returns {string} ISO date string
 */
function toISODate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate booking fees from activity pricing
 * @param {object} activity - Activity record from database
 * @param {object} partyInformation - { adult, senior, youth, child } (metadata only, not used for pricing)
 * @param {DateTime} startDate - DateTime (metadata only, not used for pricing)
 * @param {DateTime} endDate - DateTime (metadata only, not used for pricing)
 * @returns {object} { registrationFees, transactionFees, tax, total }
 */
function calculateBookingFees(activity, partyInformation, startDate, endDate) {
  logger.debug("Calculating booking fees:", { activity: activity?.activityId });

  // Simple single-item pricing: look up activity price (no date/occupant calculations)
  const price = activity?.price ?? DEFAULT_PRICE;
  const txFeePercent =
    activity?.transactionFeePercent ?? DEFAULT_TRANSACTION_FEE_PERCENT;
  const taxPercent = activity?.taxPercent ?? DEFAULT_TAX_PERCENT;

  const registrationFees = price;
  const transactionFees = registrationFees * (txFeePercent / 100);
  const tax = (registrationFees + transactionFees) * (taxPercent / 100);
  const total = registrationFees + transactionFees + tax;

  // Round to 2 decimals using Math.round to avoid floating point issues
  const roundToTwoDecimals = (num) => Math.round(num * 100) / 100;

  logger.debug("Calculated fees:", {
    registrationFees,
    transactionFees,
    tax,
    total,
  });

  return {
    registrationFees: roundToTwoDecimals(registrationFees),
    transactionFees: roundToTwoDecimals(transactionFees),
    tax: roundToTwoDecimals(tax),
    total: roundToTwoDecimals(total),
  };
}

/**
 * Sanitize and validate string input
 * @param {any} value - Input value
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitizeString(value, maxLength = 200) {
  if (!value) return "";
  return String(value).trim().slice(0, maxLength);
}

async function getBookingsByUserId(userId, props) {
  logger.debug("Getting booking by userId:", userId);
  try {
    let params = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      IndexName: USERID_INDEX_NAME,
      KeyConditionExpression: "#userId = :userId",
      ExpressionAttributeNames: {
        "#userId": USERID_PROPERTY_NAME,
      },
      ExpressionAttributeValues: {
        ":userId": marshall(userId),
      },
    };

    let filterExpression = "";

    if (props?.bookingId) {
      filterExpression = "bookingId = :bookingId";
      params.ExpressionAttributeValues[":bookingId"] = marshall(
        props.bookingId
      );
    }
    if (props?.startDate) {
      filterExpression =
        (filterExpression ? filterExpression + " AND " : "") +
        "startDate >= :startDate";
      params.ExpressionAttributeValues[":startDate"] = marshall(
        props.startDate
      );
    }
    if (props?.endDate) {
      filterExpression =
        (filterExpression ? filterExpression + " AND " : "") +
        "endDate <= :endDate";
      params.ExpressionAttributeValues[":endDate"] = marshall(props.endDate);
    }

    // Only add FilterExpression if it's not empty
    if (filterExpression) {
      params.FilterExpression = filterExpression;
    }

    const result = await runQuery(params);
    return await getGeoZoneForBooking(result);
  } catch (error) {
    throw new Exception(`Error getting booking by userId: ${error}`);
  }
}

/**
 * Finds an active (in-progress or confirmed) booking owned by a user for a given
 * product on a given startDate. Used to enforce the one-pass-per-user-per-product-per-day
 * rule from issue #458. Returns the first match, or null if none.
 */
async function findUserActiveBookingForProductOnDate(userId, productBookingPk, startDate) {
  if (!userId || !productBookingPk || !startDate) return null;
  const params = {
    TableName: TRANSACTIONAL_DATA_TABLE_NAME,
    IndexName: USERID_INDEX_NAME,
    KeyConditionExpression: '#userId = :userId AND begins_with(sk, :startDatePrefix)',
    FilterExpression: 'pk = :pk AND #status IN (:inProgress, :confirmed)',
    ExpressionAttributeNames: {
      '#userId': USERID_PROPERTY_NAME,
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':userId': marshall(userId),
      ':startDatePrefix': marshall(`${startDate}::`),
      ':pk': marshall(productBookingPk),
      ':inProgress': marshall(BOOKING_STATUS_ENUMS[0]),
      ':confirmed': marshall(BOOKING_STATUS_ENUMS[1]),
    },
  };
  const result = await runQuery(params);
  return result?.items?.[0] || null;
}

async function getBookingByBookingId(
  bookingId,
  userId = null,
  fetchAccessPoints = false
) {
  logger.debug("Getting booking by bookingId:", bookingId);
  try {
    let data = await getOneByGlobalId(bookingId, TRANSACTIONAL_DATA_TABLE_NAME);
    if (!data) {
      logger.error("getOneByGlobalId returned null/undefined!", { bookingId });
      throw new Exception(`Booking not found (BookingID: ${bookingId})`, { code: 404 });
    }
    
    if (fetchAccessPoints) {
      console.debug("Fetching access points for booking:", bookingId);
      await getAndAttachNestedProperties(data, ["entryPoint", "exitPoint"]);
    }
    return data;
  } catch (error) {
    logger.error("Error in getBookingByBookingId:", {
      bookingId,
      errorMessage: error?.message,
      errorCode: error?.code,
      stack: error?.stack,
    });
    throw new Exception("Error getting booking by bookingId", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

async function getBookingsByActivityDetails(
  collectionId,
  activityType,
  activityId,
  startDate = null,
  endDate = null,
  limit = null,
  lastEvaluatedKey = null
) {
  logger.debug(
    "Getting bookings by activity details:",
    collectionId,
    activityType,
    activityId,
    startDate,
    endDate,
    limit,
    lastEvaluatedKey
  );
  try {
    let query = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: {
        ":pk": marshall(
          `booking::${collectionId}::${activityType}::${activityId}`
        ),
      },
    };

    if (startDate) {
      if (endDate) {
        query.KeyConditionExpression += " AND sk >= :startDate";
        query["FilterExpression"] = "endDate <= :endDate";
        query.ExpressionAttributeValues[":startDate"] = marshall(startDate);
        query.ExpressionAttributeValues[":endDate"] = marshall(endDate);
      } else {
        query.KeyConditionExpression += " AND begins_with(sk, :startDate)";
        query.ExpressionAttributeValues[":startDate"] = marshall(startDate);
      }
    }

    // Add pagination
    if (limit) {
      query.Limit = limit;
    }

    if (lastEvaluatedKey) {
      query.ExclusiveStartKey = lastEvaluatedKey;
    }

    logger.debug("Querying bookings:", query);
    const result = await runQuery(query);
    logger.debug("Bookings result:", result);

    return {
      items: result.items || result,
      lastEvaluatedKey: result.LastEvaluatedKey || null,
    };
  } catch (error) {
    throw new Exception("Error getting bookings by activity details", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

async function initInventoryPoolCheckRequest(props) {

  try {
    // ==== Validate props ====

    props['bypassDiscoveryRules'] = false;
    props['projectionFields'] = PUBLIC_PRODUCTDATE_PROJECTIONS;
    props['queryTime'] = new Date().getTime();

    await validateInventoryPoolCheckProps(props);

    logger.debug(`Inventory Request Props validated successfully: ${props}`);

    // ==== Get Product ====
    const productPK = `product::${props.collectionId}::${props.activityType}::${props.activityId}`;
    const product = await getOne(productPK, props?.productId);

    if (!product) {
      throw new Exception(`Product not found (CollectionID: ${props.collectionId}, Type: ${props.activityType}, ID: ${props.activityId}, ProductID: ${props.productId})`, { code: 404 });
    }

    // ==== Get Product Dates ====
    const productDates = await fetchProductDates(props);

    logger.debug('productDates', productDates);

    if (!productDates || productDates.length === 0) {
      throw new Exception(`No ProductDates found for Product (CollectionID: ${props.collectionId}, Type: ${props.activityType}, ID: ${props.activityId}, ProductID: ${props.productId})`, { code: 404 });
    }

    // ==== Validate Booking request against Product/ProductDate data ====

    await validateBookingRequest(product, productDates, props);

    // ==== At this point, the booking request is valid ====

    // We can now proceed with checking Inventory. If the Inventory exists and is available, it will be allocated to the user. If enough Inventory is not available, the request will be rejected.

    // ==== Get Asset Reference ====

    // Note: If no AssetRef is provided in the query, we will check each ProductDate. If each ProductDate has only one AssetRef in its AssetList, we will presume that is the AssetRef to use. If there are multiple AssetRefs across ProductDates, we will throw an error and require the client to specify which AssetRef they want to book against.

    // Recall that each Booking must be against exactly one Asset. Bookings against multiple Assets are not supported by the data model - To support multiple Assets, create multiple Bookings - one for each Asset.

    let assetRef = props.assetRef;

    if (!assetRef) {
      for (const productDate of productDates) {
        if (productDate?.assetList.length === 1) {
          assetRef = productDate.assetList[0];
        } else {
          throw new Exception("Multiple AssetRefs found, please specify which AssetRef to use", { code: 400 });
        }
      }
      if (!assetRef) {
        throw new Exception("No AssetRef found for booking", { code: 404 });
      }
    }

    // ==== Create Inventory Request ====

    // Get the InventoryPool SK by assetRef

    const inventorySK = [assetRef.primaryKey.pk, assetRef.primaryKey.sk].join("::");

    // Iterate through the dates and generate InventoryPool PUT requests for each day against the specified Asset.

    const inventoryRequests = [];

    for (const productDate of productDates) {

      // Get the InventoryPool PK from the relevant properties

      const inventoryPK = `inventoryPool::${props.collectionId}::${props.activityType}::${props.activityId}::${props.productId}::${productDate.date}`;

      const inventoryRequest = {
        action: 'Update',
        data: {
          TableName: REFERENCE_DATA_TABLE_NAME,
          Key: {
            pk: marshall(inventoryPK),
            sk: marshall(inventorySK)
          },
          UpdateExpression: "ADD #availability :decrement",
          ExpressionAttributeNames: {
            "#availability": "availability"
          },
          ExpressionAttributeValues: {
            ":decrement": marshall(props?.invQuantity * -1),
            ":minimum": marshall(props?.invQuantity)
          },
          ConditionExpression: "attribute_exists(pk) AND #availability >= :minimum"
        }
      };

      inventoryRequests.push(inventoryRequest);
    }

    logger.debug(`Generated ${Object.keys(inventoryRequests || {}).length} inventory request(s) for booking`);

    return inventoryRequests;

  } catch (error) {
    logger.error('Failure initializing Booking:', error);
    throw new Exception('Error initializing booking', {
      code: 400,
      error: error,
    });

  }
}

async function validateInventoryPoolCheckProps(props) {
  try {
    const requiredProps = ["collectionId", "activityType", "activityId", "productId", "startDate", "queryTime", "invQuantity"];
    for (const prop of requiredProps) {
      if (!props[prop]) {
        throw new Exception(`Missing required property: ${prop}`, { code: 400 });
      }
    }
  } catch (error) {
    throw new Exception("Error validating inventory pool check properties", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

async function validateBookingRequest(product, productDates, props) {
  try {

    // ===== Validate Product data ====

    // Is the Product reservable?
    if (!product?.reservationPolicy?.isReservable) {
      throw "Product is not reservable";
    }

    // Are the min/max number of days allowed for booking respected?
    const numberOfDays = productDates?.length;

    logger.debug(`Number of days requested: ${numberOfDays}`);

    if (product.reservationPolicy?.minTotalDays && numberOfDays < product.reservationPolicy.minTotalDays) {
      throw `Minimum ${product.reservationPolicy.minTotalDays} booking days required`;
    }

    if (product.reservationPolicy?.maxTotalDays && numberOfDays > product.reservationPolicy.maxTotalDays) {
      throw `Maximum ${product.reservationPolicy.maxTotalDays} booking days allowed`;
    }

    // === Calculate queryTime in the timezone of the product for accurate reservation window validation ===

    // Get the timezone from the product metadata (default to UTC if not specified)
    const timezone = product.timezone;

    // Convert the queryTime to the product's timezone

    // ==== Validate ProductDate data on each day ====
    logger.debug(`Query time: ${props.queryTime}`);
    logger.debug(`Inventory quantity requested: ${props.invQuantity}`);

    logger.debug(`Validating booking request against ProductDate data for each day of the booking...`);

    // Vehicle parking day-use passes are one pass per booking (one vehicle).
    // The public site caps the selector at 1; enforce it server-side too (#566).
    if (product?.activitySubType === 'vehicleParking' && Number(props?.invQuantity) > 1) {
      throw `Vehicle parking passes are limited to one pass per booking`;
    }

    for (const productDate of productDates ?? []) {

      console.log('productDate', productDate);

      // Is the ProductDate reservable?
      if (!productDate?.reservationContext?.isReservable) {
        throw `ProductDate ${productDate.date} is not reservable`;
      }

      // Is the queryTime within the reservation window for the ProductDate?
      const resWindow = productDate?.reservationContext?.temporalWindows?.reservationWindow;

      if (resWindow.open > props.queryTime || resWindow.close < props.queryTime) {
        throw `It is outside the reservation window for ProductDate ${productDate.date}`;
      }

      // Is the min/max daily inventory limit respected for the ProductDate?

      if (productDate?.reservationContext?.maxDailyInventory < props?.invQuantity) {
        throw `Maximum daily inventory limit exceeded for ProductDate ${productDate.date}`;
      }

      if (productDate?.reservationContext?.minDailyInventory > props?.invQuantity) {
        throw `Minimum daily inventory limit not met for ProductDate ${productDate.date}`;
      }

    }

    logger.debug(`Booking request validated successfully against Product and ProductDate data.`);

    // ==== Booking request is valid at this point, we can proceed with booking creation ====

    return true;

  } catch (error) {
    logger.error('Error validating booking request:', error);
    throw new Exception("Error validating booking request:", {
      code: 400,
      error: error,
    });
  }
}

async function createBooking(props) {
  try {
    logger.debug('Creating booking', {
      collectionId: props?.collectionId,
      activityType: props?.activityType,
      activityId: props?.activityId,
      productId: props?.productId,
      startDate: props?.startDate,
      endDate: props?.endDate,
      invQuantity: props?.invQuantity,
      smsOptIn: Boolean(props?.smsOptIn),
    });

    const {
      collectionId,
      activityType,
      activityId,
      productId,
    } = props;

    props['bypassDiscoveryRules'] = false;
    props['projectionFields'] = PUBLIC_PRODUCTDATE_PROJECTIONS;
    props['queryTime'] = new Date().getTime();

    // === Validate props ===

    await validateBookingCreateProps(props);

    // === Block duplicate booking for the same user/product/startDate (issue #458) ===
    // One pass per user per product per day. Cancelled and expired bookings don't count.
    const productBookingPk = `booking::${collectionId}::${activityType}::${activityId}::${productId}`;
    const duplicate = await findUserActiveBookingForProductOnDate(props.userId, productBookingPk, props.startDate);
    if (duplicate) {
      throw new Exception(
        `You already have a ${duplicate.status} booking for this pass on ${props.startDate}. Cancel it before booking again.`,
        { code: 409, data: { existingBookingId: duplicate.bookingId, status: duplicate.status } }
      );
    }

    // === Get the Product ===

    const productPK = `product::${collectionId}::${activityType}::${activityId}`;
    const product = await getOne(productPK, productId);

    if (!product) {
      throw new Exception(`Product not found (CollectionID: ${collectionId}, Type: ${activityType}, ID: ${activityId}, ProductID: ${productId})`, { code: 404 });
    }

    // === Get the relevant ProductDates ===

    const productDates = await fetchProductDates(props);

    if (!productDates || productDates.length === 0) {
      throw new Exception(`No ProductDates found for Product (CollectionID: ${collectionId}, Type: ${activityType}, ID: ${activityId}, ProductID: ${productId})`, { code: 404 });
    }

    // === Validate the booking request against the Product and ProductDate data ===
    await validateBookingRequest(product, productDates, props);

    logger.debug(`Booking request validated successfully against Product and ProductDate data.`);

    // ==== At this point, the booking request is valid ====

    // We can now proceed with checking Inventory. If the Inventory exists and is available, it will be allocated to the user. If enough Inventory is not available, the request will be rejected.

    // ==== Get Asset Reference ====

    // Note: If no AssetRef is provided in the query, we will check each ProductDate. If each ProductDate has only one AssetRef in its AssetList, we will presume that is the AssetRef to use. If there are multiple AssetRefs across ProductDates, we will throw an error and require the client to specify which AssetRef they want to book against.

    // Recall that each Booking must be against exactly one Asset. Bookings against multiple Assets are not supported by the data model - To support multiple Assets, create multiple Bookings - one for each Asset.

    let assetRef = props?.assetRef;

    if (!assetRef) {
      for (const productDate of productDates) {
        if (productDate?.assetList.length === 1) {
          assetRef = productDate.assetList[0];
        } else {
          throw new Exception("Multiple AssetRefs found, please specify which AssetRef to use", { code: 400 });
        }
      }
      if (!assetRef) {
        throw new Exception("No AssetRef found for booking", { code: 404 });
      }
    }

    // ==== Create Inventory Requests ====

    // This will create one update request per day against that day's InventoryPool for the specified Asset. If any of the requests fail due to insufficient Inventory, the entire booking request will be rejected and no Inventory will be allocated.

    const inventoryRequests = createInventoryRequests(assetRef, productDates, props?.invQuantity);

    // ==== Create Booking Requests ====

    // This will create one BookingDate item per day of the booking, plus one Booking item that represents the overall Booking.

    const { bookingRequest, bookingDateRequests } = await initBookingRequestItems(product, productDates, assetRef, props);

    return bookingDateRequests.concat(bookingRequest).concat(inventoryRequests);

  } catch (error) {
    logger.error('Error creating booking:', error);
    throw error;
  }
}


function createInventoryRequests(assetRef, productDates, invQuantity) {
  try {
    const numericQuantity = Number(invQuantity);
    if (!Number.isFinite(numericQuantity) || numericQuantity <= 0) {
      throw new Exception(`Invalid inventory quantity: ${invQuantity}`, { code: 400 });
    }

    // Get the InventoryPool SK by assetRef
    const inventorySK = [assetRef.primaryKey.pk, assetRef.primaryKey.sk].join("::");

    // Iterate through the dates and generate InventoryPool PUT requests for each day against the specified Asset.

    const inventoryRequests = [];

    for (const productDate of productDates) {

      // Get the InventoryPool PK from the relevant properties

      const inventoryPK = `inventoryPool::${productDate.collectionId}::${productDate.activityType}::${productDate.activityId}::${productDate.productId}::${productDate.date}`;

      const inventoryRequest = {
        action: 'Update',
        data: {
          TableName: REFERENCE_DATA_TABLE_NAME,
          Key: {
            pk: marshall(inventoryPK),
            sk: marshall(inventorySK)
          },
          UpdateExpression: "ADD #availability :decrement",
          ExpressionAttributeNames: {
            "#availability": "availability"
          },
          ExpressionAttributeValues: {
            ":quantity": marshall(numericQuantity),
            ":decrement": marshall(numericQuantity * -1)
          },
          ConditionExpression: "attribute_exists(pk) AND #availability >= :quantity"
        }
      };

      inventoryRequests.push(inventoryRequest);
    }

    logger.debug(`Generated ${Object.keys(inventoryRequests || {}).length} inventory request(s) for booking`);

    return inventoryRequests;
  } catch (error) {
    logger.error('Error creating inventory requests for booking.');
    throw error;
  }
}

async function initBookingRequestItems(product, productDates, assetRef, props) {
  try {
    // === Destructure ===
    const {
      collectionId,
      activityType,
      activityId,
      productId,
      startDate,
      endDate,
      queryTime,
      userId,
    } = props;

    // === Generate Secure IDs ===
    const globalId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();

    // === Set Session Timeout ===

    // TODO: improve this to distinguish session/cart etc...
    // For now, cart timer, session timer, hold timer, etc... are all used interchangeably and represent the amount of time that inventory will be held for a user while they complete the booking process.

    const timeout = product?.holdDuration?.minutes || DEFAULT_SESSION_LENGTH;
    const sessionExpiry = addMinutes(new Date(queryTime), timeout).getTime();

    // === Resolve owner identity from Cognito ===
    // Name, email, and phone for the booking owner come from the verified
    // Cognito profile keyed by `userId` (the authenticated sub), not from the
    // request body — clients must not be able to put another user's identity
    // on a booking (Ref #480). Address fields stay from props.
    const ownerIdentity = await resolveAuthenticatedOccupantIdentity(userId);

    // The pass sub-type (e.g. 'trailUse') lives on the activity - products
    // don't carry one, so `product.activitySubType` was always undefined and
    // the attribute never made it onto the booking.
    const activity = await getActivityByActivityId(collectionId, activityType, activityId);

    // === Build the child BookingDates first
    const bookingDateItems = productDates.map((productDate) => initBookingDateItem(globalId, product, productDate, assetRef, props));

    logger.debug(`${bookingDateItems.length} booking date items initialized for booking creation.`);

    // === Whitelist and sanitize input fields ===
    let bookingItem = {
      // === Server-controlled fields ===
      pk: `booking::${collectionId}::${activityType}::${activityId}::${productId}`,
      sk: `${startDate}::${globalId}`,
      gsipk: userId,
      gsisk: startDate,
      schema: 'booking',
      globalId: globalId,
      bookingId: globalId,
      sessionId: sessionId,
      sessionInitTime: queryTime,
      sessionExpiry: sessionExpiry,
      collectionId: collectionId,
      activityType: activityType,
      activitySubType: activity?.activitySubType || product?.activitySubType,
      activityId: activityId,
      productId: productId,
      startDate: startDate,
      endDate: endDate,
      userId: userId,
      displayName: formatBookingName(product?.displayName, startDate, endDate),
      productDisplayName: product?.displayName,
      facilityDisplayName: sanitizeString(props?.facilityDisplayName, 200),
      geozoneDisplayName: sanitizeString(props?.geozoneDisplayName, 200),
      status: BOOKING_STATUS_ENUMS[0],
      isPending: 'PENDING', // For expiry sparse GSI1
      timezone: product.timezone,
      asset: assetRef?.primaryKey,
      reservationPolicySnapshot: deleteEmptyAttributes(product.reservationPolicy),
      reservationContext: buildBookingReservationContext(product, productDates, queryTime),
      partyPolicySnapshot: deleteEmptyAttributes(product.partyPolicy),
      partyContext: deleteEmptyAttributes(props.partyInformation),
      invQuantity: props?.invQuantity,
      smsOptIn: Boolean(props?.smsOptIn),
      namedOccupant: ownerIdentity
        ? {
          firstName: ownerIdentity.firstName,
          lastName: ownerIdentity.lastName,
          contactInfo: {
            email: ownerIdentity.email,
            mobilePhone: ownerIdentity.mobilePhone,
            homePhone: sanitizeString(
              props?.namedOccupant?.contactInfo?.homePhone,
              20
            ),
            streetAddress: sanitizeString(
              props?.namedOccupant?.contactInfo?.streetAddress,
              200
            ),
            unitNumber: sanitizeString(
              props?.namedOccupant?.contactInfo?.unitNumber,
              20
            ),
            postalCode: sanitizeString(
              props?.namedOccupant?.contactInfo?.postalCode,
              20
            ),
            city: sanitizeString(props?.namedOccupant?.contactInfo?.city, 100),
            province: sanitizeString(
              props?.namedOccupant?.contactInfo?.province,
              50
            ),
            country: sanitizeString(
              props?.namedOccupant?.contactInfo?.country,
              50
            ),
          },
        }
        : null,
      vehicleInformation: Array.isArray(props.vehicleInformation)
        ? props.vehicleInformation.slice(0, 5).map((v) => ({
          licensePlate: sanitizeString(v.licensePlate, 20),
          licensePlateRegistrationRegion: sanitizeString(
            v.licensePlateRegistrationRegion,
            50
          ),
          vehicleMake: sanitizeString(v.vehicleMake, 50),
          vehicleModel: sanitizeString(v.vehicleModel, 50),
          vehicleColour: sanitizeString(v.vehicleColour, 30),
        }))
        : [],
      equipmentInformation: sanitizeString(props.equipmentInformation, 1000),
      quantity: props?.invQuantity,
      feePolicySnapshot: deleteEmptyAttributes(product.feePolicy),
      bookingDates: bookingDateItems.map((bd) => {
        return {
          pk: bd.pk,
          sk: bd.sk,
        };
      }),
      // // === Not yet implemented: ===
      // // itineraryRuleSnapshot,
      // // itinerary,
      // // partyContext,
      // // feeContext,
      // // changeContext,
    };

    for (const key in bookingItem?.namedOccupant?.contactInfo) {
      if (!props.namedOccupant?.contactInfo || props.namedOccupant.contactInfo[key] === "") {
        delete bookingItem.namedOccupant.contactInfo[key];
      }
    }

    logger.debug(`Booking item initialized for booking creation.`);

    // Format bookingItems for batch write
    const bookingPutRequest = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [{
        key: {
          pk: bookingItem.pk,
          sk: bookingItem.sk,
        },
        data: bookingItem,
      }],
      BOOKING_PUT_CONFIG
    );

    logger.debug(`Booking put request initialized for booking creation.`);

    const bookingDatePutRequests = await quickApiPutHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      bookingDateItems.map((item) => {
        return {
          key: {
            pk: item.pk,
            sk: item.sk,
          },
          data: item,
        };
      }),
      BOOKINGDATES_PUT_CONFIG
    );

    logger.debug(`BookingDate put requests initialized for booking creation.`);

    return {
      bookingRequest: bookingPutRequest,
      bookingDateRequests: bookingDatePutRequests
    };

  } catch (error) {
    logger.error('Error initializing booking item for booking creation.');
    throw error;
  }
}

function formatBookingName(displayName, startDate, endDate) {
  if (startDate !== endDate) {
    return `${displayName}, ${startDate} - ${endDate}`;
  }
  return `${displayName}, ${startDate}`;
}

function deleteEmptyAttributes(obj) {
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];

      // Delete if null or undefined
      if (value === null || value === undefined) {
        delete obj[key];
        continue;
      }

      // Delete if empty array
      if (Array.isArray(value) && value.length === 0) {
        delete obj[key];
        continue;
      }

      // Delete if empty object
      if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) {
        delete obj[key];
        continue;
      }

      // Recursively clean nested objects and arrays
      if (typeof value === 'object') {
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === 'object' && item !== null) {
              deleteEmptyAttributes(item);
            }
          });
        } else {
          deleteEmptyAttributes(value);
        }

        // Delete if object became empty after recursive cleanup
        if (Object.keys(value).length === 0) {
          delete obj[key];
        }
      }
    }
  }

  return obj;
}

function buildBookingReservationContext(product, productDates, queryTime) {
  try {

    const firstDay = productDates[0];
    const lastDay = productDates[productDates.length - 1];

    let isRestrictedBookingTriggered = false;

    if (firstDay?.reservationContext?.temporalWindows?.bookingRestrictionWindow) {
      if (queryTime > firstDay.reservationContext.temporalWindows.bookingRestrictionWindow?.open && queryTime < firstDay.reservationContext.temporalWindows.bookingRestrictionWindow?.close) {
        isRestrictedBookingTriggered = true;
      }
    }

    // Format the overall BookingReservationContextbased on the first and last day of the booking, as well as the reservation context of the Product itself

    const bookingReservationContext = {
      arrivalDate: firstDay.date,
      departureDate: lastDay.date,
      totalDays: productDates.length,
      checkInTime: firstDay?.reservationContext?.temporalAnchors?.checkInTime || null,
      checkOutTime: lastDay?.reservationContext?.temporalAnchors?.checkOutTime || null,
      noShowTime: firstDay?.reservationContext?.temporalAnchors?.noShowTime || null,
      restrictedBookingTriggered: isRestrictedBookingTriggered,
      // Append the reservation context from the Product itself
      ...product.reservationContext,
    };

    logger.debug('Built booking reservation context', {
      arrivalDate: bookingReservationContext?.arrivalDate,
      departureDate: bookingReservationContext?.departureDate,
      totalDays: bookingReservationContext?.totalDays,
    });

    return bookingReservationContext;

  } catch (error) {
    logger.error('Error building booking reservation context for booking creation.');
    throw error;
  }
}

function initBookingDateItem(bookingId, product, productDate, assetRef, props) {
  try {

    // === Generate Secure IDs ===
    const globalId = crypto.randomUUID();

    // === Build the BookingDate item ===
    let bookingDateItem = {
      pk: `bookingDate::${bookingId}`,
      sk: productDate.date,
      schema: 'bookingDate',
      productDate: {
        pk: productDate.pk,
        sk: productDate.sk,
      },
      globalId: globalId,
      bookingId: bookingId,
      userId: props?.userId,
      date: productDate.date,
      asset: assetRef?.primaryKey,
      quantity: props?.invQuantity,
      reservationPolicySnapshot: productDate.reservationPolicy,
      reservationContext: productDate.reservationContext,
      partyPolicySnapshot: productDate.partyPolicy,
      changePolicySnapshot: productDate.changePolicy,
      feePolicySnapshot: productDate.feePolicy,
      // === Not yet implemented: ===
      // partyContext,
      // feeContext,
      // changeContext,
    };

    return bookingDateItem;

  } catch (error) {
    logger.error(`Error initializing booking date (${productDate?.date}) item for booking creation`);
    throw error;
  }
}

async function validateBookingCreateProps(props) {
  try {
    const requiredProps = ["collectionId", "activityType", "activityId", "productId", "startDate", "queryTime", "invQuantity", "userId"];
    for (const prop of requiredProps) {
      if (!props[prop]) {
        throw new Exception(`Missing required property: ${prop}`, { code: 400 });
      }
    }
  } catch (error) {
    throw new Exception("Error validating inventory pool check properties", {
      code: 400,
      error: error.message || String(error),
    });
  }
}

function formatBookingResponsePublic(bookingResponse) {
  try {
    // This function will format the booking response for the public API. It will take the raw booking request items and format them into a more user-friendly format - namely sanitizing internal fields, etc... before sending the response back to the client.

    let bookingData = [];

    bookingResponse.map((item) => {
      if (item?.action === 'Put') {
        bookingData.push(unmarshall(item?.data?.Item));
      }
    });

    let formattedResponse = {};
    let bookingDatesInfo = {};
    let bookingInfo = {};

    const booking = bookingData.filter((item) => item?.schema === 'booking')[0];

    if (booking) {
      bookingInfo = {
        bookingId: booking.bookingId,
        sessionId: booking.sessionId,
        sessionInitTime: booking.sessionInitTime,
        sessionExpiry: booking.sessionExpiry,
        startDate: booking.startDate,
        endDate: booking.endDate,
        status: booking.status,
        asset: booking.asset,
        reservationContext: booking.reservationContext,
        partyContext: booking.partyContext,
        feeContext: booking.feeContext,
        userId: booking.userId,
        displayName: booking.displayName,
        arrivalDate: booking.reservationContext?.arrivalDate,
        departureDate: booking.reservationContext?.departureDate,
        noShowTime: booking.reservationContext?.noShowTime,
      };
    }

    const bookingDates = bookingData.filter((item) => item?.schema === 'bookingDate');

    if (bookingDates) {
      bookingDatesInfo = {
        totalDays: bookingDates.length,
        totalInventory: bookingDates.reduce((total, item) => {
          const dailyInventory = item.quantity || 0;
          return total + dailyInventory;
        }, 0),
      };
    }

    formattedResponse = {
      ...bookingInfo,
      ...bookingDatesInfo,
    };

    return formattedResponse;

  } catch (error) {
    // Dont crash out if this doesn't work - just log the error and return the unformatted items
    logger.error('Error formatting booking response for public API:', error);
    return 'Success';
  }
}

async function completeBooking(bookingId, sessionId, props, { sub } = {}) {
  try {

    // === get queryTime ===
    const queryTime = new Date().getTime();
    if (props && typeof props === 'object') {
      props['queryTime'] = queryTime;
    }

    // === Get original Booking ===

    const booking = await getBookingByBookingId(bookingId);

    // If no booking found, throw error
    if (!booking) {
      throw new Exception(`Booking not found (BookingID: ${bookingId})`, { code: 404 });
    }

    // === Validate the Booking can be completed ===

    validateBookingCompletion(booking, sessionId, props);

    // For now, BookingDates do not have to be updated when finalizing the booking, but this may need to change in the future

    // === Update the Booking item with any necessary changes for finalization ===

    let updatedBookingItem = {
      // === Server-controlled fields ===
      bookingCompletionTime: queryTime,
      status: BOOKING_STATUS_ENUMS[1],
      // Remove pending state from GSI1
      isPending: { action: 'remove' },
    };

    // When the FE-driven complete handler invokes us with the authenticated
    // sub, rewrite the named-occupant identity fields from Cognito and accept
    // booking-context fields (address/vehicle/equipment) from the request.
    // Server-side webhook completions (e.g. Worldline) pass no sub — in that
    // case leave namedOccupant + booking-context alone (createBooking already
    // wrote them when the booking was first created). Ref #480.
    if (sub) {
      const ownerIdentity = await resolveAuthenticatedOccupantIdentity(sub);
      updatedBookingItem.namedOccupant = ownerIdentity
        ? {
          firstName: ownerIdentity.firstName,
          lastName: ownerIdentity.lastName,
          contactInfo: {
            email: ownerIdentity.email,
            mobilePhone: ownerIdentity.mobilePhone,
            homePhone: sanitizeString(
              props?.namedOccupant?.contactInfo?.homePhone,
              20
            ),
            streetAddress: sanitizeString(
              props?.namedOccupant?.contactInfo?.streetAddress,
              200
            ),
            unitNumber: sanitizeString(
              props?.namedOccupant?.contactInfo?.unitNumber,
              20
            ),
            postalCode: sanitizeString(
              props?.namedOccupant?.contactInfo?.postalCode,
              20
            ),
            city: sanitizeString(props?.namedOccupant?.contactInfo?.city, 100),
            province: sanitizeString(
              props?.namedOccupant?.contactInfo?.province,
              50
            ),
            country: sanitizeString(
              props?.namedOccupant?.contactInfo?.country,
              50
            ),
          },
        }
        : null;
      updatedBookingItem.vehicleInformation = Array.isArray(props?.vehicleInformation)
        ? props.vehicleInformation.slice(0, 5).map((v) => ({
          licensePlate: sanitizeString(v.licensePlate, 20),
          licensePlateRegistrationRegion: sanitizeString(
            v.licensePlateRegistrationRegion,
            50
          ),
          vehicleMake: sanitizeString(v.vehicleMake, 50),
          vehicleModel: sanitizeString(v.vehicleModel, 50),
          vehicleColour: sanitizeString(v.vehicleColour, 30),
        }))
        : [];
      updatedBookingItem.equipmentInformation = sanitizeString(props?.equipmentInformation, 1000);
    }

    // Format the update request for the Booking item

    let bookingUpdateRequest = await quickApiUpdateHandler(
      TRANSACTIONAL_DATA_TABLE_NAME,
      [
        {
          key: {
            pk: booking.pk,
            sk: booking.sk,
          },
          data: updatedBookingItem,
        }
      ],
      BOOKING_UPDATE_CONFIG
    );

    // Merge updated fields with original booking for email params generation
    const completeBookingForEmail = {
      ...booking,
      ...updatedBookingItem
    };

    const emailParams = await generateEmailParams(completeBookingForEmail);

    // SMS confirmation params, dispatched by the handler alongside the email.
    // The opt-in flag arrives with the FE complete request — post-#404 the FE
    // no longer sends identity/opt-in fields at create — so prefer it here and
    // fall back to the value captured on the booking record for server-side
    // completions. The phone is the Cognito-resolved number now stored on the
    // finalized booking (completeBookingForEmail.namedOccupant.contactInfo).
    const smsParams = {
      ...completeBookingForEmail,
      smsOptIn:
        typeof props?.smsOptIn === 'boolean'
          ? props.smsOptIn
          : Boolean(completeBookingForEmail?.smsOptIn),
    };

    // Return the update + notification params for the handler to commit and
    // dispatch in that order. We intentionally do NOT send the email/SMS here:
    // the SQS enqueue must happen *after* batchTransactData succeeds, otherwise
    // a failed DynamoDB write would leave the user with a confirmation for a
    // booking that was never saved.
    return {
      updateRequests: bookingUpdateRequest,
      emailParams,
      smsParams,
    };


  } catch (error) {
    logger.error(`Booking finalization failed.`);
    throw error;
  }
}

async function getParkNameForCollection(collectionId) {
  if (!collectionId) return null;
  try {
    const queryParams = {
      TableName: REFERENCE_DATA_TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': marshall(`geozone::${collectionId}`)
      }
    };
    const result = await runQuery(queryParams);
    const geozones = (result?.items || []).filter(item => item.sk !== 'counter');
    if (geozones.length === 0) return null;
    const primary = geozones.sort((a, b) => (a.geozoneId || 0) - (b.geozoneId || 0))[0];
    return primary?.displayName || null;
  } catch (error) {
    logger.warn(`Failed to fetch park name for collectionId ${collectionId}:`, error.message || error);
    return null;
  }
}

/**
 * Build the email template payload from a booking record. The caller passes the
 * fully-populated booking — for confirmation that's the just-completed record
 * with named occupant + vehicle info, for cancellation it's the booking as
 * fetched from DynamoDB.
 */
async function generateEmailParams(booking) {
  try {

    // get bookingDates
    const bookingDates = await getBookingDatesByBookingId(booking.bookingId);

    // get parkName from the geozone reference data; fall back to the collectionId
    // so the email still has something usable if lookup fails.
    const parkName = (await getParkNameForCollection(booking.collectionId)) || booking.collectionId;

    // Build user-facing URLs to the public app's account pages. The template
    // gates the "View booking" and "Cancel booking" buttons on these being
    // truthy; we leave them null if PUBLIC_FRONTEND_DOMAIN isn't configured
    // so the buttons simply don't render rather than pointing to garbage.
    const publicDomain = process.env.PUBLIC_FRONTEND_DOMAIN
      ? `https://${process.env.PUBLIC_FRONTEND_DOMAIN}`.replace(/^https:\/\/https:\/\//, "https://")
      : null;
    const accountBookingUrl = publicDomain
      ? `${publicDomain}/account/bookings/${booking.bookingId}`
      : null;
    const cancellationUrl = publicDomain
      ? `${publicDomain}/account/bookings/cancel/${booking.bookingId}`
      : null;

    // Derive arrival/departure from the booking-date items. Each item carries
    // the resolved reservation context whose temporalAnchors (checkInTime /
    // checkOutTime) are epoch-millis values the email's formatDate/formatTime
    // helpers can render directly — giving both the date and the time of day.
    // We sort by date so the first item is arrival and the last is departure.
    // (The prior code read `reservationContext.arrivalDate.ts`, which never
    // existed on the booking — arrivalDate is stored as a plain date string —
    // so Arrival/Departure silently dropped out of the email.)
    const dateItems = (bookingDates?.items || [])
      .filter((item) => item.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const firstDay = dateItems[0];
    const lastDay = dateItems[dateItems.length - 1];
    const arrivalDate = firstDay?.reservationContext?.temporalAnchors?.checkInTime || firstDay?.date || null;
    const departureDate = lastDay?.reservationContext?.temporalAnchors?.checkOutTime || lastDay?.date || null;

    // Clean product/pass name (e.g. "Lindsay's Loop Trail - AM"), without the
    // date suffix that `displayName` carries.
    const productName = booking.productDisplayName || booking.displayName;

    // Friendly pass-type label for the booking-card subtitle (matches the
    // confirmation design, e.g. "Day-use pass"). Falls back to the capitalized
    // raw activityType for any type without an explicit label.
    const ACTIVITY_TYPE_LABELS = {
      dayuse: 'Day-use pass',
      frontcountryCamp: 'Frontcountry camping',
      backcountryCamp: 'Backcountry camping',
      groupCamp: 'Group camping',
      boating: 'Boating',
      cabinStay: 'Cabin stay',
      canoe: 'Canoe',
    };
    const activityTypeLabel = ACTIVITY_TYPE_LABELS[booking.activityType]
      || (booking.activityType ? booking.activityType.charAt(0).toUpperCase() + booking.activityType.slice(1) : 'Pass');

    const emailParams = {
      booking: {
        bookingId: booking.bookingId,
        displayName: booking.displayName,
        invQuantity: dateItems.reduce((total, item) => total + (item.quantity || 0), 0),
        arrivalDate,
        departureDate,
        accountBookingUrl,
        activityType: booking.activityType ? booking.activityType.charAt(0).toUpperCase() + booking.activityType.slice(1) : 'Activity',
        activityTypeLabel,
        productName,
        cancellationUrl,
        namedOccupant: booking.namedOccupant || {},
      },
      customer: {
        firstName: booking.namedOccupant?.firstName || '',
        lastName: booking.namedOccupant?.lastName || '',
        licensePlate: booking.vehicleInformation?.[0]?.licensePlate || '',
        licensePlateRegion: booking.vehicleInformation?.[0]?.licensePlateRegistrationRegion || '',
      },
      location: {
        parkName: parkName
      },
      branding: {
        logoUrl: 'https://bcparks.ca/assets/logos/default-logo.png',
      }
    };

    return emailParams;

  } catch (error) {
    logger.error('Error generating email parameters:', error);
    return null;
  }
}

function validateBookingCompletion(booking, sessionId, props) {
  try {
    const queryTime = props.queryTime;
    const bookingId = booking.bookingId;

    // If the booking isn't 'in progress', we shouldn't be trying to complete it - throw error;
    if (booking.status !== BOOKING_STATUS_ENUMS[0]) {
      throw new Exception(`Booking is not '${BOOKING_STATUS_ENUMS[0]}' and cannot be completed (BookingID: ${bookingId}, Status: ${booking.status})`, { code: 400 });
    }

    // If the sessionId doesn't match, throw error
    if (booking.sessionId !== sessionId) {
      throw new Exception(`Invalid session ID for booking completion (BookingID: ${bookingId})`, { code: 403 });
    }

    // If the session has expired, throw error
    if (booking.sessionExpiry < queryTime) {
      throw new Exception(`Session has expired for booking completion (BookingID: ${bookingId})`, { code: 403 });
    }

    // If the reservation window has closed, throw error
    const resWindow = booking.reservationContext?.temporalWindows?.reservationWindow;
    if (resWindow && (queryTime < resWindow.open || queryTime > resWindow.close)) {
      throw new Exception(`It is outside the reservation window for booking completion (BookingID: ${bookingId})`, { code: 400 });
    }

    // If no named occupant information is provided, throw error (for now, we require named occupant information to complete the booking - this may be relaxed in the future)
    if (!props?.namedOccupant) {
      throw new Exception(`Named occupant information is required for booking completion (BookingID: ${bookingId})`, { code: 400 });
    }

    // TODO: Validate against other change, reservation, party and fee policies as needed.

    return true;

  } catch (error) {
    logger.error(`Error validating booking completion for booking ID ${booking?.bookingId}.`, {
      error: error.message || String(error),
      status: booking?.status,
      sessionExpiry: booking?.sessionExpiry,
      queryTime: props?.queryTime,
      hasNamedOccupant: !!props?.namedOccupant,
    });
    throw error;
  }
}

async function cancelBooking(bookingId, userId, reason = null) {
  try {
    const booking = await getBookingByBookingId(bookingId);

    // Verify ownership
    if (booking.userId !== userId) {
      throw new Exception(`User ${userId} does not own booking ${bookingId}`, {
        code: 403,
      });
    }

    // Check if already cancelled
    if (booking.status === "cancelled") {
      throw new Exception(`Booking ${bookingId} is already cancelled`, {
        code: 400,
      });
    }

    // Return the putItem for cancellation
    return {
      key: { pk: booking.pk, sk: booking.sk },
      data: {
        status: "cancelled",
        cancellationReason: reason || "Customer requested cancellation",
        cancelledAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw new Exception("Error cancelling booking", {
      code: 400,
      error: error,
    });
  }
}

/**
 * GET /bookings/admin handler helper functions
 */

/*
 * Validates admin userId requirements
 */
function validateAdminRequirements(userObject, collectionId) {
  if (userObject.isAdmin && !collectionId) {
    throw new Exception("collectionId is required for Admin users", {
      code: 400,
    });
  }
}

/*
 * Calculates effective date range based on userId type and provided dates
 */
function calculateDateRange(userObject, startDate, endDate) {
  let effectiveStartDate, effectiveEndDate;

  if (userObject.isAdmin) {
    // Admin logic consideration: limit to 30 days ago by default, max 90 days range
    // Prevent admin from slamming a huge data pull
    const defaultStart = toISODate(addDays(new Date(), -30));
    effectiveStartDate = startDate || defaultStart;
    effectiveEndDate =
      endDate || toISODate(addDays(new Date(effectiveStartDate), 90));
  } else {
    // Non-admin logic: startDate is 90 days ago up 1 year in future unless otherwise specified
    effectiveStartDate = startDate || toISODate(addDays(new Date(), -90));
    effectiveEndDate = endDate || toISODate(addYears(new Date(), 1));
  }

  return { effectiveStartDate, effectiveEndDate };
}

/*
 * Validates the provided date range
 */
function validateDateRange(startDate, endDate, isAdmin) {
  const startDateObj = new Date(startDate);
  const endDateObj = new Date(endDate);
  const now = new Date();
  const thirtyOneDaysAgo = addDays(now, -31);

  if (isAdmin && startDateObj < thirtyOneDaysAgo) {
    throw new Exception(
      "Admin startDate cannot be more than 30 days in the past",
      {
        code: 400,
      }
    );
  }

  const ninetyOneDaysAfterStart = addDays(startDateObj, 91);
  if (isAdmin && endDateObj > ninetyOneDaysAfterStart) {
    throw new Exception("Admin endDate range cannot exceed 90 days", {
      code: 400,
    });
  }
}

/*
 * Builds activity filters from query parameters
 */
function buildActivityFilters(activityType, activityId) {
  const filters = {};
  if (activityType) filters.activityType = activityType;
  if (activityId) filters.activityId = activityId;
  return filters;
}

/*
 * Validates user access to the specified collection
 */
function validateCollectionAccess(collections, userObject) {
  for (const collectionId of collections) {
    if (!userObject.isAdmin && !userObject.collection.includes(collectionId)) {
      throw new Exception(
        `user does not have access to collection ${collectionId}`,
        {
          code: 403,
        }
      );
    }
  }
}

/*
 * Fetches all activities for the given collections and filters
 */
async function fetchAllActivities(collections, filters) {
  const allActivities = [];

  logger.debug("Collections to check:", collections);

  for (const collection of collections) {
    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });
    allActivities.push(...activities.items);
  }

  logger.debug("Activities to check:", allActivities);
  return allActivities;
}

/**
 * Sorts and paginates all bookings
 */
function allBookingsSortAndPaginate(
  allBookings,
  limit,
  nextPageKey,
  sortOrder
) {
  // Sort by collectionId first, then by startDate within each collection
  allBookings.sort((a, b) => {
    const collectionComparison =
      sortOrder === "desc"
        ? b.collectionId.localeCompare(a.collectionId)
        : a.collectionId.localeCompare(b.collectionId);

    if (collectionComparison !== 0) {
      return collectionComparison;
    }

    // Within same collection, sort by startDate
    const dateA = new Date(a.startDate);
    const dateB = new Date(b.startDate);
    return dateA - dateB;
  });

  return {
    items: allBookings.slice(0, limit),
    lastEvaluatedKey: nextPageKey,
  };
}

/*
 * Fetches all bookings with pagination and sorting
 */
async function fetchBookingsWithPagination(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit = 20,
  lastEvaluatedKey = null,
  sortOrder = "asc",
  sortBy = "startDate"
) {
  // Handle different sorting strategies as per the user's request
  switch (sortBy) {
    case "collectionId":
      return await fetchBookingsSortedByCollection(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder
      );
    case "activityType":
    case "activityId":
      return await fetchBookingsSortedByActivity(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder,
        sortBy
      );
    case "startDate":
    case "endDate":
      return await fetchBookingsSortedByDate(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder,
        sortBy
      );
    default:
      // Otherwise default to startDate sorting
      return await fetchBookingsSortedByDate(
        collections,
        filters,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastEvaluatedKey,
        sortOrder,
        "startDate"
      );
  }
}

/**
 * Fetch bookings sorted by collectionId
 */
async function fetchBookingsSortedByCollection(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit,
  lastEvaluatedKey,
  sortOrder
) {
  let currentCollectionIndex = 0;
  let lastBookingDate = null;
  let lastBookingId = null;

  // Check for pagination state from lastEvaluatedKey if passed in
  logger.debug("lastEvaluatedKey: ", lastEvaluatedKey);
  if (lastEvaluatedKey && lastEvaluatedKey.sortBy === "collectionId") {
    currentCollectionIndex = lastEvaluatedKey.collectionIndex || 0;
    lastBookingDate = lastEvaluatedKey.lastBookingDate;
    lastBookingId = lastEvaluatedKey.lastBookingId;
  }

  // Sort collections by prefix ("bcparks_") and then by number ("_123")
  const sortedCollections = [...collections].sort((a, b) => {
    const [prefixA, numA] = a.split("_");
    const [prefixB, numB] = b.split("_");

    if (prefixA !== prefixB) {
      return sortOrder === "desc"
        ? prefixB.localeCompare(prefixA)
        : prefixA.localeCompare(prefixB);
    }

    const diff = parseInt(numA, 10) - parseInt(numB, 10);
    return sortOrder === "desc" ? -diff : diff;
  });

  // Start going through the collections starting from currentCollectionIndex (or 0)
  for (
    let collectionIdx = currentCollectionIndex;
    collectionIdx < sortedCollections.length;
    collectionIdx++
  ) {
    const collection = sortedCollections[collectionIdx];
    const collectionBookings = [];

    // Get all the activities for this collection based on filters (if passed in)
    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });

    // Get all the bookings from all the activities in the collection
    for (const activity of activities.items) {
      const bookings = await getBookingsByActivityDetails(
        activity.collectionId,
        activity.activityType,
        activity.activityId,
        effectiveStartDate,
        effectiveEndDate,
        null,
        null
      );

      collectionBookings.push(...bookings.items);
    }
    logger.debug("collectionBookings: ", collectionBookings);

    // We default sort all bookings in the collection by startDate
    collectionBookings.sort((a, b) => {
      const dateA = new Date(a.startDate);
      const dateB = new Date(b.startDate);
      const comparison = dateA - dateB;

      return comparison;
    });

    // If we're picking up from a lastEvaluatedKey, find where to start
    let startIndex = 0;
    if (
      collectionIdx === currentCollectionIndex &&
      lastBookingDate &&
      lastBookingId
    ) {
      // Find the position after the last returned booking
      for (let i = 0; i < collectionBookings.length; i++) {
        const booking = collectionBookings[i];
        if (
          booking.startDate === lastBookingDate &&
          booking.globalId === lastBookingId
        ) {
          startIndex = i + 1;
          break;
        }
      }
    }

    // Slice the bookings to start from the correct position
    const availableBookings = collectionBookings.slice(startIndex);

    // Track the number of bookings we've collected against the limit provided
    if (availableBookings.length >= limit) {
      const items = availableBookings.slice(0, limit);

      // Create a nextPageKey to point to the last booking we returned
      // This will be used for lastEvaluatedKey in the next request
      const lastItem = items[items.length - 1];
      const nextPageKey = {
        sortBy: "collectionId",
        collectionIndex: collectionIdx,
        lastBookingDate: lastItem.startDate,
        lastBookingId: lastItem.globalId,
        collectionId: collection,
      };

      return {
        items: items,
        lastEvaluatedKey: nextPageKey,
      };
    }

    // If we don't have enough bookings in this collection, but have some
    if (availableBookings.length > 0) {
      // Check if there are more collections to go through
      if (collectionIdx + 1 < sortedCollections.length) {
        // Return what we have and the nextPageKey for the next collection
        const nextPageKey = {
          sortBy: "collectionId",
          collectionIndex: collectionIdx + 1,
          lastBookingDate: null,
          lastBookingId: null,
          collectionId: sortedCollections[collectionIdx + 1],
        };

        return {
          items: availableBookings.slice(0, limit),
          lastEvaluatedKey: nextPageKey,
        };
      } else {
        // Last collection, return what we have
        return {
          items: availableBookings.slice(0, limit),
          lastEvaluatedKey: null,
        };
      }
    }
  }

  // No more collections or bookings, return empty
  return {
    items: [],
    lastEvaluatedKey: null,
  };
}

/**
 * Fetch bookings sorted by activityType or activityId
 */
async function fetchBookingsSortedByActivity(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit,
  lastEvaluatedKey,
  sortOrder,
  sortBy
) {
  let currentCollectionIndex = 0;
  let currentActivityIndex = 0;
  let activityLastKey = null;

  // Check for pagination state from lastEvaluatedKey if passed in
  if (lastEvaluatedKey && lastEvaluatedKey.sortBy === sortBy) {
    currentCollectionIndex = lastEvaluatedKey.collectionIndex || 0;
    currentActivityIndex = lastEvaluatedKey.activityIndex || 0;
    activityLastKey = lastEvaluatedKey.activityLastKey;
  }

  // Sort collections by prefix ("bcparks_") and then by number ("_123")
  const sortedCollections = [...collections].sort((a, b) => {
    const [prefixA, numA] = a.split("_");
    const [prefixB, numB] = b.split("_");

    if (prefixA !== prefixB) {
      return sortOrder === "desc"
        ? prefixB.localeCompare(prefixA)
        : prefixA.localeCompare(prefixB);
    }

    const diff = parseInt(numA, 10) - parseInt(numB, 10);
    return sortOrder === "desc" ? -diff : diff;
  });

  const collectedBookings = [];

  // Go through each collection starting from currentCollectionIndex (or 0)
  for (
    let collectionIdx = currentCollectionIndex;
    collectionIdx < sortedCollections.length;
    collectionIdx++
  ) {
    const collection = sortedCollections[collectionIdx];

    // Get all the activities for this collection
    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });

    // Sort the activities by type or id - this determines our fetch order
    activities.items.sort((a, b) => {
      let comparison;
      if (sortBy === "activityType") {
        comparison =
          sortOrder === "desc"
            ? b.activityType.localeCompare(a.activityType)
            : a.activityType.localeCompare(b.activityType);

        // Sort by activityId if same type
        if (comparison === 0) {
          return Number(a.activityId) - Number(b.activityId);
        }
      } else if (sortBy === "activityId") {
        comparison =
          sortOrder === "desc"
            ? Number(b.activityId) - Number(a.activityId)
            : Number(a.activityId) - Number(b.activityId);
      }
      return comparison;
    });

    // Determine where to start in the activities list
    const startActivityIdx =
      collectionIdx === currentCollectionIndex ? currentActivityIndex : 0;

    // Fetch bookings from activities in sorted order until we have enough
    for (
      let activityIdx = startActivityIdx;
      activityIdx < activities.items.length;
      activityIdx++
    ) {
      const activity = activities.items[activityIdx];

      // Use the activityLastKey only if we're resuming from the exact same activity
      const lastKey =
        collectionIdx === currentCollectionIndex &&
          activityIdx === currentActivityIndex
          ? activityLastKey
          : null;

      // Fetch bookings from this activity with pagination
      // DynamoDB naturally sorts by startDate due to our sort key structure
      const bookings = await getBookingsByActivityDetails(
        activity.collectionId,
        activity.activityType,
        activity.activityId,
        effectiveStartDate,
        effectiveEndDate,
        limit,
        lastKey
      );

      collectedBookings.push(...bookings.items);

      // If we have enough bookings or this activity has more data
      if (collectedBookings.length >= limit || bookings.lastEvaluatedKey) {
        // Sort what we have collected so far by activity field, then by date
        // This ensures proper ordering across activities
        collectedBookings.sort((a, b) => {
          let comparison;
          if (sortBy === "activityType") {
            comparison =
              sortOrder === "desc"
                ? b.activityType.localeCompare(a.activityType)
                : a.activityType.localeCompare(b.activityType);

            // Secondary sort by activityId, then startDate
            if (comparison === 0) {
              const idComparison = Number(a.activityId) - Number(b.activityId);
              if (idComparison === 0) {
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateA - dateB;
              }
              return idComparison;
            }
          } else if (sortBy === "activityId") {
            comparison =
              sortOrder === "desc"
                ? Number(b.activityId) - Number(a.activityId)
                : Number(a.activityId) - Number(b.activityId);

            // Secondary sort by activityType, then startDate
            if (comparison === 0) {
              const typeComparison = a.activityType.localeCompare(
                b.activityType
              );
              if (typeComparison === 0) {
                const dateA = new Date(a.startDate);
                const dateB = new Date(b.startDate);
                return dateA - dateB;
              }
              return typeComparison;
            }
          }
          return comparison;
        });

        const items = collectedBookings.slice(0, limit);

        // Create next page key to track our position
        let nextPageKey = null;
        if (bookings.lastEvaluatedKey) {
          // More bookings in current activity
          nextPageKey = {
            sortBy: sortBy,
            collectionIndex: collectionIdx,
            activityIndex: activityIdx,
            activityLastKey: bookings.lastEvaluatedKey,
            collectionId: collection,
            activityType: activity.activityType,
            activityId: activity.activityId,
          };
        } else if (activityIdx + 1 < activities.items.length) {
          // More activities in current collection
          nextPageKey = {
            sortBy: sortBy,
            collectionIndex: collectionIdx,
            activityIndex: activityIdx + 1,
            activityLastKey: null,
            collectionId: collection,
            activityType: activities.items[activityIdx + 1].activityType,
            activityId: activities.items[activityIdx + 1].activityId,
          };
        } else if (collectionIdx + 1 < sortedCollections.length) {
          // More collections
          nextPageKey = {
            sortBy: sortBy,
            collectionIndex: collectionIdx + 1,
            activityIndex: 0,
            activityLastKey: null,
            collectionId: sortedCollections[collectionIdx + 1],
            activityType: null,
            activityId: null,
          };
        }

        return {
          items: items,
          lastEvaluatedKey:
            collectedBookings.length >= limit ? nextPageKey : null,
        };
      }
    }
  }

  // Final sort for any remaining results (when we've processed all collections)
  collectedBookings.sort((a, b) => {
    let comparison;
    if (sortBy === "activityType") {
      comparison =
        sortOrder === "desc"
          ? b.activityType.localeCompare(a.activityType)
          : a.activityType.localeCompare(b.activityType);

      // Secondary sort by activityId, then startDate
      if (comparison === 0) {
        const idComparison = Number(a.activityId) - Number(b.activityId);
        if (idComparison === 0) {
          const dateA = new Date(a.startDate);
          const dateB = new Date(b.startDate);
          return dateA - dateB;
        }
        return idComparison;
      }
    } else if (sortBy === "activityId") {
      comparison =
        sortOrder === "desc"
          ? Number(b.activityId) - Number(a.activityId)
          : Number(a.activityId) - Number(b.activityId);

      // Secondary sort by activityType, then startDate
      if (comparison === 0) {
        const typeComparison = a.activityType.localeCompare(b.activityType);
        if (typeComparison === 0) {
          const dateA = new Date(a.startDate);
          const dateB = new Date(b.startDate);
          return dateA - dateB;
        }
        return typeComparison;
      }
    }
    return comparison;
  });

  // Return what we have with no next page key
  return {
    items: collectedBookings.slice(0, limit),
    lastEvaluatedKey: null,
  };
}

/**
 * Fetch bookings sorted by startDate or endDate
 */
async function fetchBookingsSortedByDate(
  collections,
  filters,
  effectiveStartDate,
  effectiveEndDate,
  limit,
  lastEvaluatedKey,
  sortOrder,
  sortBy
) {
  const allBookings = [];
  let targetDate = null;
  let targetBookedAt = null;

  // Parse pagination state
  if (lastEvaluatedKey && lastEvaluatedKey.sortBy === sortBy) {
    targetDate = lastEvaluatedKey.lastItemDate;
    targetBookedAt = lastEvaluatedKey.lastItemBookedAt;
  }

  // Fetch from all collections
  for (
    let collectionIdx = 0;
    collectionIdx < collections.length;
    collectionIdx++
  ) {
    const collection = collections[collectionIdx];

    const activities = await getActivitiesByCollectionId(collection, filters, {
      paginated: false,
    });

    activities.items.sort((a, b) => {
      if (a.activityType !== b.activityType) {
        return a.activityType.localeCompare(b.activityType);
      }
      return Number(a.activityId) - Number(b.activityId);
    });

    for (
      let activityIdx = 0;
      activityIdx < activities.items.length;
      activityIdx++
    ) {
      const activity = activities.items[activityIdx];

      const bookings = await getBookingsByActivityDetails(
        activity.collectionId,
        activity.activityType,
        activity.activityId,
        effectiveStartDate,
        effectiveEndDate,
        null,
        null
      );

      // Filter bookings based on cursor position
      for (const booking of bookings.items) {
        if (targetDate && targetBookedAt) {
          const bookingDate = new Date(booking[sortBy]);
          const cursorDate = new Date(targetDate);
          const bookingTimestamp = new Date(booking.bookedAt).getTime();
          const cursorTimestamp = new Date(targetBookedAt).getTime();

          if (sortOrder === "asc") {
            // Skip items until we're past the cursor
            // For items with same date, use bookedAt timestamp as tiebreaker
            if (bookingDate < cursorDate) {
              continue;
            }
            if (bookingDate.getTime() === cursorDate.getTime() && bookingTimestamp <= cursorTimestamp) {
              continue;
            }
          } else {
            // Skip items until we're past the cursor (descending)
            // For items with same date, use bookedAt timestamp as tiebreaker
            if (bookingDate > cursorDate) {
              continue;
            }
            if (bookingDate.getTime() === cursorDate.getTime() && bookingTimestamp >= cursorTimestamp) {
              continue;
            }
          }
        }

        allBookings.push(booking);
      }
    }
  }

  // Sort the collected bookings
  allBookings.sort((a, b) => {
    const dateA = new Date(a[sortBy]);
    const dateB = new Date(b[sortBy]);

    const comparison = sortOrder === "desc" ? dateB - dateA : dateA - dateB;

    // Use bookedAt timestamp as tiebreaker for items with same date
    if (comparison === 0) {
      const bookedAtA = new Date(a.bookedAt).getTime();
      const bookedAtB = new Date(b.bookedAt).getTime();
      return sortOrder === "desc" ? bookedAtB - bookedAtA : bookedAtA - bookedAtB;
    }
    return comparison;
  });

  // Get only the requested limit
  const items = allBookings.slice(0, limit);

  // Determine if there are more results to be passed as hasMore
  const hasMore = allBookings.length > limit;
  const nextPageKey =
    hasMore && items.length > 0
      ? {
        sortBy: sortBy,
        lastItemDate: items[items.length - 1][sortBy],
        lastItemBookedAt: items[items.length - 1].bookedAt,
        collectionIndex: 0,
        activityIndex: 0,
      }
      : null;

  return {
    items: items,
    lastEvaluatedKey: nextPageKey,
  };
}

/**
 * Publishes transaction command to SNS
 * @param {object} booking - The ID of the booking to cancel
 *   @param {string} booking.bookingId - The ID of the booking to cancel
 *   @param {string} booking.userId - The userId identifier requesting the cancellation
 *   @param {string} booking.clientTransactionId - The client transaction ID associated with the booking
 *   @param {object} booking.feeInformation - The fee information associated with the booking
 * @param {string} reason - The reason for cancellation
 */
async function refundPublishCommand(booking, reason) {
  // TODO: trnAmount calculation based on booking details
  // const trnAmount = calculateRefundAmount(booking);

  // Publish to refund topic if there's a transaction
  const refundMessage = {
    clientTransactionId: booking.clientTransactionId,
    bookingId: booking.bookingId,
    userId: booking.userId,
    refundAmount: booking.feeInformation?.total || 0, // TODO: adjust based on cancellation policy
    reason:
      booking.cancellationReason ||
      reason ||
      "Cancelled by user via self-serve",
  };

  const messageAttributes = {
    eventType: {
      DataType: "String",
      StringValue: "TRANSACTION_CANCELLATION",
    },
    clientTransactionId: {
      DataType: "String",
      StringValue: booking.clientTransactionId,
    },
  };

  const publishCommand = snsPublishCommand(
    process.env.REFUND_REQUEST_TOPIC_ARN,
    refundMessage,
    `Refund Request for Booking ${booking.bookingId}`,
    messageAttributes
  );

  const result = await snsPublishSend(publishCommand);
  logger.info(
    `Refund request published for transaction ${booking.clientTransactionId}`
  );

  return result;
}

async function getExpiredBookings() {
  try {
    const now = new Date().getTime();
    console.log('now', now);

    const expiredBookingsQuery = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      IndexName: SPARSE_GSI1_NAME,
      KeyConditionExpression: "#isPending = :isPending AND #expiry < :now",
      ExpressionAttributeNames: {
        "#isPending": "isPending",
        "#expiry": "sessionExpiry",
      },
      ExpressionAttributeValues: {
        ":isPending": { S: 'PENDING' },
        ":now": { N: now.toString() },
      },
    };

    console.log('expiredBookingsQuery', expiredBookingsQuery);

    return await runQuery(expiredBookingsQuery, null, null, false);

  } catch (error) {
    logger.error("Error fetching expired bookings.");
    throw error;
  }
}

async function getBookingDatesByBookingId(bookingId) {
  try {
    const pk = `bookingDate::${bookingId}`;
    const bookingDatesQuery = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      KeyConditionExpression: "#pk = :pk",
      ExpressionAttributeNames: {
        "#pk": "pk",
      },
      ExpressionAttributeValues: {
        ":pk": { S: pk },
      },
    };
    return await runQuery(bookingDatesQuery, null, null, false);
  } catch (error) {
    logger.error(`Error fetching booking dates for booking ${bookingId}.`);
    throw error;
  }
}

async function flagCancelledBooking(booking, queryTime, reason, userId) {
  if (!userId || typeof userId !== "string") {
    // userId is part of the ConditionExpression — without it the comparison
    // would resolve against the literal string "undefined" and silently fail
    // every cancellation. Fail loudly instead.
    throw new Error("flagCancelledBooking requires a userId");
  }
  try {

    // The presence of `cancellationTime` is the single race-guard marker for
    // a cancelled booking. Nothing else in the codebase should set this
    // attribute — if you find yourself wanting to, route through this
    // function or update the ConditionExpression below.
    const expressionAttributeNames = {
      "#status": "status",
      "#cancellationTime": "cancellationTime",
      "#isPending": "isPending",
      "#userId": "userId",
      "#pk": "pk",
    };
    const expressionAttributeValues = {
      ":status": { S: BOOKING_STATUS_ENUMS[2] },
      ":cancelledAt": { N: queryTime.toString() },
      ":isPending": { S: 'PENDING' },
      ":userId": { S: userId },
    };
    let updateExpression = "SET #status = :status, #cancellationTime = :cancelledAt, #isPending = :isPending";

    if (reason) {
      expressionAttributeNames["#cancellationReason"] = "cancellationReason";
      expressionAttributeValues[":cancellationReason"] = { S: String(reason) };
      updateExpression += ", #cancellationReason = :cancellationReason";
    }

    const updateItem = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: {
        pk: { S: booking.pk },
        sk: { S: booking.sk },
      },
      UpdateExpression: updateExpression,
      // Race guard combining three invariants:
      //   - attribute_exists(#pk): the booking row must still exist (a
      //     concurrent delete shouldn't upsert a phantom cancelled tombstone).
      //   - #userId = :userId: ownership must hold atomically with the write,
      //     not just at the earlier read-time pre-check.
      //   - attribute_not_exists(#cancellationTime): only the first racing
      //     cancel wins; the loser gets ConditionalCheckFailed and we return
      //     400 "already cancelled" instead of sending a second email.
      ConditionExpression: "attribute_exists(#pk) AND #userId = :userId AND attribute_not_exists(#cancellationTime)",
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    // return update formatted for batchTransactData
    return [
      {
        data: updateItem,
        action: 'Update'
      }
    ];

  } catch (error) {
    logger.error(`Error flagging cancelled booking ${booking.bookingId}.`);
    throw error;
  }
}

/**
 * Send booking confirmation email to SQS queue. Looks up the recipient by
 * the user's immutable Cognito `sub` (not username or session email) so the
 * email reaches the verified address on the account that owns the booking.
 *
 * @param {object} emailParams - Structured email params from generateEmailParams
 * @param {string} sub - Cognito sub of the booking owner (from request claims)
 * @returns {Promise<Object|null>} SQS response, or null if the email was skipped
 */
async function sendBookingConfirmationEmail(emailParams, sub) {
  const bookingId = emailParams?.booking?.bookingId;
  try {
    if (!emailParams?.booking) {
      logger.warn('Cannot send confirmation email - missing email params', { sub });
      return null;
    }

    if (!sub) {
      logger.warn('Cannot send confirmation email - no sub provided', { bookingId });
      return null;
    }

    const userInfo = await getUserInfoBySub(sub, 'public');
    const attrs = userInfo?.Attributes || [];
    const accountEmail = attrs.find(attr => attr.Name === 'email')?.Value;
    const emailVerified = attrs.find(attr => attr.Name === 'email_verified')?.Value === 'true';

    if (!accountEmail) {
      logger.warn('Cannot send confirmation email - no email address on Cognito user', {
        bookingId,
        sub
      });
      return null;
    }

    if (!emailVerified) {
      // Don't send to unverified addresses — an attacker could set the email
      // to a victim's address and trigger booking-related mail to them.
      // Logged at error so CloudWatch alarms can pick it up: a successful
      // booking owner should not normally be unverified.
      logger.error('Skipped confirmation email - email not verified', {
        bookingId,
        sub
      });
      return null;
    }

    const result = await sendConfirmationEmail({
      // `sendConfirmationEmail` reads recipientEmail from the top-level
      // `email` key (different shape than the cancellation helper, which
      // reads from customerData.email). Without this the payload validator
      // rejects with "Missing required field: recipientEmail".
      email: accountEmail,
      bookingData: emailParams.booking,
      customerData: {
        ...emailParams.customer,
        email: accountEmail,
      },
      locationData: emailParams.location,
      brandingData: emailParams.branding,
      locale: 'en'
    });

    logger.info('Booking confirmation email queued successfully', {
      bookingId,
      messageId: result.messageId
    });

    return result;

  } catch (error) {
    logger.error('Failed to queue booking confirmation email', {
      bookingId,
      error: error.message,
      // The schema-validation Exception attaches a `data.errors` array;
      // log it so the per-field reason isn't swallowed by the generic
      // "Invalid email payload" message.
      validationErrors: error?.data?.errors || error?.errors,
      stack: error.stack,
    });
    // Don't throw - email failure shouldn't break the booking flow
    return null;
  }
}

/**
 * Send booking cancellation email to SQS queue. Looks up the recipient by
 * the user's immutable Cognito `sub` (not username or session email) so the
 * email reaches the verified address on the account that owns the booking.
 *
 * @param {object} emailParams - Structured email params from generateEmailParams
 * @param {string} sub - Cognito sub of the booking owner (from request claims)
 * @returns {Promise<Object|null>} SQS response, or null if the email was skipped
 */
async function sendBookingCancellationEmail(emailParams, sub) {
  const bookingId = emailParams?.booking?.bookingId;
  try {
    if (!emailParams?.booking) {
      logger.warn('Cannot send cancellation email - missing email params', { sub });
      return null;
    }

    if (!sub) {
      logger.warn('Cannot send cancellation email - no sub provided', { bookingId });
      return null;
    }

    const userInfo = await getUserInfoBySub(sub, 'public');
    const attrs = userInfo?.Attributes || [];
    const accountEmail = attrs.find(attr => attr.Name === 'email')?.Value;
    const emailVerified = attrs.find(attr => attr.Name === 'email_verified')?.Value === 'true';

    if (!accountEmail) {
      logger.warn('Cannot send cancellation email - no email address on Cognito user', {
        bookingId,
        sub
      });
      return null;
    }

    if (!emailVerified) {
      // Don't send to unverified addresses — an attacker could set the email
      // to a victim's address and trigger booking-related mail to them.
      // Logged at error so CloudWatch alarms can pick it up: a successful
      // booking owner should not normally be unverified.
      logger.error('Skipped cancellation email - email not verified', {
        bookingId,
        sub
      });
      return null;
    }

    const result = await sendCancellationEmail({
      bookingData: emailParams.booking,
      customerData: {
        ...emailParams.customer,
        email: accountEmail,
      },
      locationData: emailParams.location,
      brandingData: emailParams.branding,
      locale: 'en'
    });

    logger.info('Booking cancellation email queued successfully', {
      bookingId,
      messageId: result.messageId
    });

    return result;

  } catch (error) {
    logger.error('Failed to queue booking cancellation email', {
      bookingId,
      error: error.message,
      validationErrors: error?.data?.errors || error?.errors,
      stack: error.stack,
    });
    // Don't throw - email failure shouldn't break the cancel flow
    return null;
  }
}


/**
 * Look up the pass sub-type for every activity the given bookings reference.
 * One query per collection, keyed `collectionId::activityType::activityId`.
 * @param {Array} items - booking items
 * @returns {Promise<object>} map of activity key -> activitySubType
 */
async function getActivitySubTypes(items) {
  const subTypes = {};
  const collectionIds = [...new Set(items.map(b => b.collectionId).filter(Boolean))];

  for (const collectionId of collectionIds) {
    try {
      const res = await getActivitiesByCollectionId(collectionId, {});
      for (const activity of res?.items || []) {
        subTypes[`${collectionId}::${activity.activityType}::${activity.activityId}`] = activity.activitySubType;
      }
    } catch (error) {
      logger.warn(`Failed to fetch activities for collectionId ${collectionId}:`, error.message || error);
    }
  }

  return subTypes;
}

/**
 * Enrich bookings with the geozone display name and image, and the pass
 * sub-type. The bookings table stores none of the three reliably, so the cards
 * on My bookings would otherwise have to fetch them one by one.
 * @param {object} bookings - The bookings result object with items array
 * @returns {Promise<object>} Bookings with geozoneDisplayName, geozoneImageUrl and activitySubType
 */
async function getGeoZoneForBooking(bookings) {
  logger.debug('getGeoZoneForBooking called with:', { 
    hasItems: !!bookings?.items, 
    itemCount: bookings?.items?.length || 0 
  });
  
  if (!bookings?.items || bookings.items.length === 0) {
    return bookings;
  }

  try {
    // Get unique collectionIds from bookings
    const collectionIds = [...new Set(bookings.items.map(b => b.collectionId).filter(Boolean))];
    logger.debug('Unique collectionIds to fetch geozones for:', collectionIds);
    
    // Fetch the primary geozone for each collectionId
    const geozoneCache = {};
    for (const collectionId of collectionIds) {
      try {
        // Query all geozones for this collection
        const queryParams = {
          TableName: REFERENCE_DATA_TABLE_NAME,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: {
            ":pk": marshall(`geozone::${collectionId}`)
          }
        };
        
        logger.debug(`Querying geozones for ${collectionId}`);
        const result = await runQuery(queryParams);
        
        // Filter out the counter item after query (can't use FilterExpression on primary key)
        if (result?.items) {
          result.items = result.items.filter(item => item.sk !== 'counter');
        }
        
        logger.debug(`Query result for ${collectionId}:`, { 
          itemCount: result?.items?.length || 0,
          firstItem: result?.items?.[0] ? { 
            displayName: result.items[0].displayName,
            geozoneId: result.items[0].geozoneId 
          } : null
        });
        
        // Get the first geozone (usually the main park/area)
        if (result?.items && result.items.length > 0) {
          // Sort by geozoneId to get the primary one
          const sortedGeozones = result.items.sort((a, b) => (a.geozoneId || 0) - (b.geozoneId || 0));
          geozoneCache[collectionId] = sortedGeozones[0];
          logger.debug(`Cached geozone for ${collectionId}: ${geozoneCache[collectionId]?.displayName}`);
        } else {
          logger.warn(`No geozones found for collectionId ${collectionId}`);
        }
      } catch (error) {
        logger.warn(`Failed to fetch geozone for collectionId ${collectionId}:`, error.message || error);
        logger.error('Full error:', error);
      }
    }
    
    // Bookings made before the sub-type fix have no activitySubType of their
    // own, so fall back to the activity it was booked against.
    const subTypeCache = await getActivitySubTypes(bookings.items);

    // Attach displayName, image and pass sub-type to each booking
    bookings.items = bookings.items.map(booking => ({
      ...booking,
      geozoneDisplayName: geozoneCache[booking.collectionId]?.displayName || booking.geozoneDisplayName || booking.collectionId,
      geozoneImageUrl: geozoneCache[booking.collectionId]?.imageUrl || '',
      activitySubType: booking.activitySubType
        || subTypeCache[`${booking.collectionId}::${booking.activityType}::${booking.activityId}`]
        || ''
    }));
    
    logger.debug(`Enriched ${bookings.items.length} bookings with geozone display names`);
    logger.debug('First enriched booking:', {
      collectionId: bookings.items[0]?.collectionId,
      geozoneDisplayName: bookings.items[0]?.geozoneDisplayName
    });
    return bookings;
  } catch (error) {
    logger.error('Error enriching bookings with geozone names:', error);
    // Return original bookings if enrichment fails
    return bookings;
  }
}


module.exports = {
  allBookingsSortAndPaginate,
  buildActivityFilters,
  calculateBookingFees,
  calculateDateRange,
  cancelBooking,
  completeBooking,
  createBooking,
  fetchAllActivities,
  fetchBookingsWithPagination,
  findUserActiveBookingForProductOnDate,
  flagCancelledBooking,
  formatBookingResponsePublic,
  generateEmailParams,
  getBookingsByActivityDetails,
  getBookingByBookingId,
  getBookingsByUserId,
  getBookingDatesByBookingId,
  getExpiredBookings,
  initInventoryPoolCheckRequest,
  refundPublishCommand,
  sanitizeString,
  resolveAuthenticatedOccupantIdentity,
  sendBookingConfirmationEmail,
  sendBookingCancellationEmail,
  validateAdminRequirements,
  validateDateRange,
  validateCollectionAccess,
  getGeoZoneForBooking

};
