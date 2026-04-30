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
const { sendConfirmationEmail, getRegionBranding } = require("../../../lib/handlers/emailDispatch/utils");
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
  PARK_NAMES_BY_COLLECTION_ID
} = require("../../common/data-constants");
const { PUBLIC_PRODUCTDATE_PROJECTIONS } = require("../productDates/configs");
const { fetchProductDates } = require("../productDates/methods");
const { DateTime } = require("luxon");
const { BOOKING_PUT_CONFIG, BOOKINGDATES_PUT_CONFIG, BOOKING_UPDATE_CONFIG } = require("./configs");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const { getUserInfoByUserName } = require("../users/methods");

const DEFAULT_SESSION_LENGTH = 30; // in minutes

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
    return result;
  } catch (error) {
    throw new Exception(`Error getting booking by userId: ${error}`);
  }
}

async function getBookingByBookingId(
  bookingId,
  userId = null,
  fetchAccessPoints = false
) {
  logger.debug("Getting booking by bookingId:", bookingId);
  try {
    let data = await getOneByGlobalId(bookingId, TRANSACTIONAL_DATA_TABLE_NAME);
    if (fetchAccessPoints) {
      console.debug("Fetching access points for booking:", bookingId);
      await getAndAttachNestedProperties(data, ["entryPoint", "exitPoint"]);
    }
    return data;
  } catch (error) {
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

    if (!productDates?.items || productDates.items.length === 0) {
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
      for (const productDate of productDates.items) {
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

    for (const productDate of productDates.items) {

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
    const numberOfDays = productDates?.items?.length;

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

    for (const productDate of productDates?.items) {

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

    // === Get the Product ===

    const productPK = `product::${collectionId}::${activityType}::${activityId}`;
    const product = await getOne(productPK, productId);

    if (!product) {
      throw new Exception(`Product not found (CollectionID: ${collectionId}, Type: ${activityType}, ID: ${activityId}, ProductID: ${productId})`, { code: 404 });
    }

    // === Get the relevant ProductDates ===

    const productDates = await fetchProductDates(props);

    if (!productDates?.items || productDates.items.length === 0) {
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
      for (const productDate of productDates.items) {
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

    for (const productDate of productDates.items) {

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
          UpdateExpression: "SET #availability = #availability - :quantity",
          ExpressionAttributeNames: {
            "#availability": "availability"
          },
          ExpressionAttributeValues: {
            ":quantity": marshall(numericQuantity)
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
    const sessionExpiry = addMinutes(new Date(), timeout).getTime();

    // === Build the child BookingDates first
    const bookingDateItems = productDates.items.map((productDate) => initBookingDateItem(globalId, product, productDate, assetRef, props));

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
      sessionExpiry: sessionExpiry,
      collectionId: collectionId,
      activityType: activityType,
      activityId: activityId,
      productId: productId,
      startDate: startDate,
      endDate: endDate,
      userId: userId,
      displayName: formatBookingName(product?.displayName, startDate, endDate),
      productDisplayName: product?.displayName,
      facilityDisplayName: sanitizeString(props?.facilityDisplayName, 200),
      bookingInitTime: queryTime,
      status: BOOKING_STATUS_ENUMS[0],
      isPending: 'PENDING', // For expiry sparse GSI1
      timezone: product.timezone,
      asset: assetRef?.primaryKey,
      reservationPolicySnapshot: deleteEmptyAttributes(product.reservationPolicy),
      reservationContext: buildBookingReservationContext(product, productDates, queryTime),
      partyPolicySnapshot: deleteEmptyAttributes(product.partyPolicy),
      partyContext: deleteEmptyAttributes(props.partyInformation),
      smsOptIn: Boolean(props?.smsOptIn),
      namedOccupant: props?.namedOccupant
        ? {
          firstName: sanitizeString(props.namedOccupant.firstName, 100),
          lastName: sanitizeString(props.namedOccupant.lastName, 100),
          contactInfo: {
            email: sanitizeString(props.namedOccupant.contactInfo?.email, 200),
            mobilePhone: sanitizeString(
              props.namedOccupant.contactInfo?.mobilePhone,
              20
            ),
            homePhone: sanitizeString(
              props.namedOccupant.contactInfo?.homePhone,
              20
            ),
            streetAddress: sanitizeString(
              props.namedOccupant.contactInfo?.streetAddress,
              200
            ),
            unitNumber: sanitizeString(
              props.namedOccupant.contactInfo?.unitNumber,
              20
            ),
            postalCode: sanitizeString(
              props.namedOccupant.contactInfo?.postalCode,
              20
            ),
            city: sanitizeString(props.namedOccupant.contactInfo?.city, 100),
            province: sanitizeString(
              props.namedOccupant.contactInfo?.province,
              50
            ),
            country: sanitizeString(
              props.namedOccupant.contactInfo?.country,
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

    const firstDay = productDates.items[0];
    const lastDay = productDates.items[productDates.items.length - 1];

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
      totalDays: productDates.items.length,
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

async function completeBooking(bookingId, sessionId, props) {
  try {

    // === get queryTime ===
    const queryTime = new Date().getTime();
    props['queryTime'] = queryTime;

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
      namedOccupant: props?.namedOccupant
        ? {
          firstName: sanitizeString(props.namedOccupant.firstName, 100),
          lastName: sanitizeString(props.namedOccupant.lastName, 100),
          contactInfo: {
            email: sanitizeString(props.namedOccupant.contactInfo?.email, 200),
            mobilePhone: sanitizeString(
              props.namedOccupant.contactInfo?.mobilePhone,
              20
            ),
            homePhone: sanitizeString(
              props.namedOccupant.contactInfo?.homePhone,
              20
            ),
            streetAddress: sanitizeString(
              props.namedOccupant.contactInfo?.streetAddress,
              200
            ),
            unitNumber: sanitizeString(
              props.namedOccupant.contactInfo?.unitNumber,
              20
            ),
            postalCode: sanitizeString(
              props.namedOccupant.contactInfo?.postalCode,
              20
            ),
            city: sanitizeString(props.namedOccupant.contactInfo?.city, 100),
            province: sanitizeString(
              props.namedOccupant.contactInfo?.province,
              50
            ),
            country: sanitizeString(
              props.namedOccupant.contactInfo?.country,
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
    };

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

    const emailParams = await generateEmailParams(booking, updatedBookingItem);

    return {
      updateRequests: bookingUpdateRequest,
      emailParams: emailParams
    };


  } catch (error) {
    logger.error(`Booking finalization failed.`);
    throw error;
  }
}

async function generateEmailParams(booking, updatedBookingItem) {
  try {

    // get bookingDates
    const bookingDates = await getBookingDatesByBookingId(booking.bookingId);

    // get parkName
    const parkName = PARK_NAMES_BY_COLLECTION_ID[booking.collectionId];

    let emailParams = {
      booking: {
        bookingId: booking.bookingId,
        invQuantity: bookingDates?.items?.reduce((total, item) => {
          const dailyInventory = item.quantity || 0;
          return total + dailyInventory;
        }, 0),
        arrivalDate: booking.reservationContext?.arrivalDate?.ts,
        departureDate: booking.reservationContext?.departureDate?.ts,
        accountBookingUrl: null,
        activityType: booking.activityType.charAt(0).toUpperCase() + booking.activityType.slice(1),
        productName: booking.displayName,
        qrCodeDataUrl: null,
        cancellationUrl: null,
      },
      customer: {
        firstName: updatedBookingItem.namedOccupant?.firstName || '',
        lastName: updatedBookingItem.namedOccupant?.lastName || '',
        licensePlate: updatedBookingItem.vehicleInformation?.[0]?.licensePlate || '',
        licensePlateRegion: updatedBookingItem.vehicleInformation?.[0]?.licensePlateRegistrationRegion || '',
      },
      location: {
        parkName: parkName
      },
      branding: {
        logoUrl: 'https://bcparks.ca/assets/logos/default-logo.png',
      }
    };

    console.log('emailParams', emailParams);

    return emailParams;

  } catch (error) {
    logger.error('Error generating email parameters for booking confirmation:', error);
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
    logger.error(`Error validating booking completion for booking ID ${booking?.bookingId}.`);
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
    if (booking.bookingStatus === "cancelled") {
      throw new Exception(`Booking ${bookingId} is already cancelled`, {
        code: 400,
      });
    }

    // Return the putItem for cancellation
    return {
      key: { pk: booking.pk, sk: booking.sk },
      data: {
        bookingStatus: "cancelled",
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
 * Publishes booking cancellation command to SNS
 * @param {object} booking - The ID of the booking to cancel
 * @param {string} booking.bookingId - The ID of the booking to cancel
 * @param {string} booking.userId - The userId identifier requesting the cancellation
 * @param {string} booking.clientTransactionId - The client transaction ID associated with the booking
 * @param {object} booking.feeInformation - The fee information associated with the booking
 * @param {string} reason - The reason for cancellation
 */
async function cancellationPublishCommand(booking, reason) {
  // Prepare cancellation message
  const cancellationMessage = {
    bookingId: booking.bookingId,
    userId: booking.userId,
    clientTransactionId: booking.clientTransactionId,
    refundAmount: booking.feeInformation?.total || 0, // TODO: adjust based on cancellation policy
    reason: reason || "Cancelled by user via self-serve",
    timestamp: new Date().toISOString(),
  };

  const messageAttributes = {
    eventType: {
      DataType: "String",
      StringValue: "BOOKING_CANCELLATION",
    },
    bookingId: {
      DataType: "String",
      StringValue: booking.bookingId,
    },
  };

  // Publish to SNS topic to trigger cancellation workflow
  const publishCommand = snsPublishCommand(
    process.env.BOOKING_NOTIFICATION_TOPIC_ARN,
    cancellationMessage,
    `Booking Cancellation: ${booking.bookingId}`,
    messageAttributes
  );

  const result = await snsPublishSend(publishCommand);

  return result;
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

async function flagCancelledBooking(booking, queryTime) {
  try {

    const updateItem = {
      TableName: TRANSACTIONAL_DATA_TABLE_NAME,
      Key: {
        pk: { S: booking.pk },
        sk: { S: booking.sk },
      },
      UpdateExpression: "SET #status = :status, #cancellationTime = :cancelledAt, #isPending = :isPending",
      ExpressionAttributeNames: {
        "#status": "status",
        "#cancellationTime": "cancellationTime",
        "#isPending": "isPending",
      },
      ExpressionAttributeValues: {
        ":status": { S: BOOKING_STATUS_ENUMS[2] },
        ":cancelledAt": { N: queryTime.toString() },
        ":isPending": { S: 'PENDING' },
      }
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
 * Send booking confirmation email to SQS queue
 * @param {object} booking - Booking data from DynamoDB
 * @returns {Promise<Object>} SQS response
 */
async function sendBookingConfirmationEmail(booking, userName) {
  try {

    // get account email:
    const userInfo = await getUserInfoByUserName(userName, 'public');

    const accountEmail = userInfo?.UserAttributes?.find(attr => attr.Name === 'email')?.Value;

    if (!accountEmail) {
      logger.warn('Cannot send confirmation email - no email address found for user', {
        bookingId: booking.bookingId,
        userName: userName
      });
      return null;
    }

    // Calculate number of guests from partyContext
    const partyInfo = booking.partyContext || {};
    const numberOfGuests = (partyInfo.adult || 0) + (partyInfo.youth || 0) + (partyInfo.child || 0) + (partyInfo.senior || 0) || 1;

    // Extract booking data
    const bookingData = {
      bookingId: booking.bookingId || booking.globalId,
      bookingReference: booking.bookingReference || booking.bookingId || booking.globalId,
      startDate: booking.startDate,
      endDate: booking.endDate,
      numberOfNights: booking.reservationContext?.totalDays || 1,
      numberOfGuests: numberOfGuests,
      status: booking.status || 'in-progress'
    };

    // Extract location data
    const locationData = {
      parkName: booking.displayName || 'BC Parks',
      facilityName: booking.displayName || booking.facilityName,
      siteNumber: booking.siteNumber,
      region: booking.collectionId || 'default',
      address: booking.address
    };

    // Extract customer data from namedOccupant
    const namedOccupant = booking.namedOccupant || {};
    const contactInfo = namedOccupant.contactInfo || {};


    const customerData = {
      firstName: namedOccupant.firstName || 'Guest',
      lastName: namedOccupant.lastName || '',
      email: contactInfo.email,
      phone: contactInfo.mobilePhone,
      address: {
        street: contactInfo.streetAddress || '',
        city: contactInfo.city || '',
        province: contactInfo.province || '',
        postalCode: contactInfo.postalCode || '',
        country: contactInfo.country || 'CA'
      }
    };

    // Get region-specific branding
    const brandingData = {};
    // const brandingData = getRegionBranding(locationData);

    // Send confirmation email to SQS queue
    const result = await sendConfirmationEmail({
      email: accountEmail,
      bookingData,
      customerData,
      locationData,
      brandingData,
      locale: booking.locale || 'en'
    });

    logger.info('Booking confirmation email queued successfully', {
      bookingId: booking.bookingId,
      recipient: customerData.email,
      messageId: result.messageId
    });

    return result;

  } catch (error) {
    logger.error('Failed to queue booking confirmation email', {
      bookingId: booking?.bookingId,
      error: error.message,
      stack: error.stack
    });
    // Don't throw - email failure shouldn't break the booking flow
    return null;
  }
}


/**
 * Enrich bookings with geozone display names
 * @param {object} bookings - The bookings result object with items array
 * @returns {Promise<object>} Bookings with geozoneDisplayName added to each booking
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
          geozoneCache[collectionId] = sortedGeozones[0].displayName;
          logger.debug(`Cached geozone name for ${collectionId}: ${geozoneCache[collectionId]}`);
        } else {
          logger.warn(`No geozones found for collectionId ${collectionId}`);
        }
      } catch (error) {
        logger.warn(`Failed to fetch geozone for collectionId ${collectionId}:`, error.message || error);
        logger.error('Full error:', error);
      }
    }
    
    // Attach displayName to each booking
    logger.debug('GeozoneCache before mapping:', geozoneCache);
    bookings.items = bookings.items.map(booking => ({
      ...booking,
      geozoneDisplayName: geozoneCache[booking.collectionId] || booking.collectionId
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
  cancellationPublishCommand,
  completeBooking,
  createBooking,
  fetchAllActivities,
  fetchBookingsWithPagination,
  flagCancelledBooking,
  formatBookingResponsePublic,
  getBookingsByActivityDetails,
  getBookingByBookingId,
  getBookingsByUserId,
  getBookingDatesByBookingId,
  getExpiredBookings,
  initInventoryPoolCheckRequest,
  refundPublishCommand,
  sanitizeString,
  sendBookingConfirmationEmail,
  validateAdminRequirements,
  validateDateRange,
  validateCollectionAccess,
  getGeoZoneForBooking

};