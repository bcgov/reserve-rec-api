const { TABLE_NAME, batchGetData, batchTransactData, runQuery, getOne } = require('/opt/dynamodb');
const { buildCompKeysFromSkField, quickApiPutHandler } = require('/opt/data-utils');
const { getProtectedAreaByOrcs } = require('/opt/protectedAreas/methods');
const { DEFAULT_TIMEZONE, Exception, logger } = require('/opt/base');
const { BC_CENTROID } = require('/opt/data-constants');
const { FACILITY_CREATE_CONFIG, FACILITY_UPDATE_CONFIG } = require('/opt/facilities/configs');

async function getFacilitiesByOrcs(orcs, params = null) {
  logger.info('Get Facilities');
  try {
    if (!orcs) {
      throw 'ORCS is required';
    }
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `facility::${orcs}` }
      }
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Facilities: ${res?.items?.length} found.`);
    return res?.items || [];
  } catch (error) {
    throw new Exception('Error getting facilities', { code: 400, error: error });
  }
}

async function getFacilityById(orcs, type, id, fetchObj = null) {
  logger.info('Get Facility By Type and ID');
  try {
    let res = await getOne(`facility::${orcs}`, `${type}::${id}`);
    if (fetchObj?.fetchActivities && res.activities) {
      let keys = buildCompKeysFromSkField(res, `activity::${orcs}`, 'activities');
      res.activities = await batchGetData(keys, TABLE_NAME);
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting facility', { code: 400, error: error });
  }
}

async function getFacilitiesBySubarea(orcs, subareaId) {
  try {
    let facilities = await getFacilitiesByOrcs(orcs);
    if (facilities?.length > 0) {
      const subarea = `subarea::${orcs}#${subareaId}`;
      facilities = facilities?.filter(facility => facility.subarea === subarea);
    }
    return facilities;
  } catch (error) {
    throw new Exception('Error getting facility by subarea', { code: 400, error: error });
  }
}

async function getNextFacilityId(orcs, facilityType) {
  const facilities = await getFacilitiesByOrcs(orcs);
  const typedFacilities = facilities?.filter(facility => facility.sk.split('::')[0] === facilityType);
  if (!typedFacilities || typedFacilities.length === 0) {
    return 1;
  }
  const idArray = typedFacilities.map(facility => parseInt(facility.sk.split('::')[1]));
  const nextId = Math.max(...idArray) + 1;
  return nextId;
}

async function generateDefaultFacilityObj(orcs, facilityType) {
  const nextId = await getNextFacilityId(orcs, facilityType);

  // construct default facility object
  return {
    pk: `facility::${orcs}`,
    sk: `${facilityType}::${nextId}`,
    schema: 'facility',
    orcs: orcs,
    identifier: nextId,
    facilityType: facilityType,
    displayName: `Facility ${orcs}-${nextId}: ${facilityType}`,
    description: '',
    isVisible: false,
    timeZone: DEFAULT_TIMEZONE,
    version: 1,
    subarea: null,
    minMapZoom: 8,
    maxMapZoom: 18,
    activities: [],
    imageUrl: '',
    address: '',
    location: {
      type: 'Point',
      coordinates: BC_CENTROID
    }
  };
}

async function postFacility(orcs, facilityType, body = null) {
  logger.info('Post New Facility');
  try {
    // Check orcs
    const park = await getProtectedAreaByOrcs(orcs);
    if (!park) {
      throw 'Invalid ORCS';
    }

    const facility = await generateDefaultFacilityObj(orcs, facilityType);

    // if body is provided, merge with default facility object
    if (body) {
      Object.assign(facility, body);
    }

    const createList = [{
      data: facility
    }];

    let command = await quickApiPutHandler(TABLE_NAME, createList, FACILITY_CREATE_CONFIG);

    console.log('command:', command);
    await batchTransactData(command);
    return facility;
  } catch (error) {
    throw new Exception('Error posting facility', { code: 400, error: error });
  }
}

async function putFacility(orcs, facilityType, facilityId, body) {
  logger.info('Put Facility');
  try {
    let updateItem = {
      key: {
        pk: `facility::${orcs}`,
        sk: `${facilityType}::${facilityId}`
      },
      data: body
    };
    let putCommand = await quickApiPutHandler(TABLE_NAME, [updateItem], FACILITY_UPDATE_CONFIG);
    const res = await batchTransactData(putCommand);
    return res;
  } catch (error) {
    throw new Exception('Error updating facility', { code: 400, error: error });
  }
}

module.exports = {
  getFacilitiesByOrcs,
  getFacilityById,
  getFacilitiesBySubarea,
  postFacility,
  putFacility
};