/**
 * Functionality and utils for subareas
 */

const { TABLE_NAME, batchTransactData, getOne, parallelizedBatchGetData, runQuery } = require('/opt/dynamodb');
const { buildCompKeysFromSkField, quickApiPutHandler, quickApiUpdateHandler } = require('/opt/data-utils');
const { Exception, logger } = require('/opt/base');
const { getProtectedAreaByOrcs } = require('/opt/protectedAreas/methods');
const { BC_BBOX, BC_CENTROID } = require('/opt/data-constants');
const { getFacilitiesBySubarea } = require('/opt/facilities/methods');
const { SUBAREA_CREATE_CONFIG, SUBAREA_UPDATE_CONFIG } = require('/opt/subareas/configs');

async function getSubareasByOrcs(orcs, params = null) {
  logger.info('Get PA Subareas');
  try {
    if (!orcs) {
      throw 'ORCS is required';
    }
    const limit = params?.limit || null;
    const lastEvaluatedKey = params?.lastEvaluatedKey || null;
    const paginated = params?.paginated || true;
    // Get subareas
    const queryObj = {
      TableName: TABLE_NAME,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: {
        ':pk': { S: `subarea::${orcs}` },
      },
    };
    const res = await runQuery(queryObj, limit, lastEvaluatedKey, paginated);
    logger.info(`Subareas: ${res?.items?.length} found.`);
    return res?.items || [];
  } catch (error) {
    throw new Exception('Error getting subareas', { code: 400, error: error });
  }
}

async function getSubareaById(orcs, id, fetchObj = null) {
  logger.info('Get Subarea By ID');
  try {
    let res = await getOne(`subarea::${orcs}`, id);
    // In the case where we want to fetch activities and/or facilites, there is no capacity unit cost saving by batching the gets, only a latency cost saving - so we can just do them in parallel to keep their results separate.
    let promiseObj = {};
    if (fetchObj?.fetchActivities && res.activities) {
      promiseObj.activities = buildCompKeysFromSkField(res, `activity::${orcs}`, 'activities');
    }
    if (fetchObj?.fetchFacilities && res?.facilities) {
      promiseObj.facilities = buildCompKeysFromSkField(res, `facility::${orcs}`, 'facilities');
    }

    if (Object.keys(promiseObj).length) {
      let results = await parallelizedBatchGetData(promiseObj, TABLE_NAME);
      // Merge the results back into the subarea object
      for (const result of results) {
        res[result.key] = result.data;
      }
    }
    return res;
  } catch (error) {
    throw new Exception('Error getting subarea', { code: 400, error: error });
  }
}

async function generateDefaultSubareaObj(orcs) {
  const nextId = await getNextSubareaId(orcs);

  // construct default subarea object
  return {
    pk: `subarea::${orcs}`,
    sk: String(nextId),
    identifier: nextId,
    schema: 'subarea',
    orcs: orcs,
    displayName: `Subarea ${orcs}-${nextId}`,
    description: '',
    isVisible: false,
    activities: [],
    facilities: [],
    searchTerms: [],
    version: 1,
    envelope: {
      type: 'Envelope',
      coordinates: BC_BBOX
    },
    location: {
      type: 'Point',
      coordinates: BC_CENTROID
    }
  };
}

async function postSubarea(orcs, body = null) {
  logger.info('Post New Subarea');
  try {
    // Check orcs
    const park = await getProtectedAreaByOrcs(orcs);
    if (!park) {
      throw 'Invalid ORCS';
    }

    const subarea = await generateDefaultSubareaObj(orcs);

    // if body provided, object merge with default subarea object
    if (body) {
      Object.assign(subarea, body);
    }

    const updateList = [{
      data: subarea
    }];

    const command = await quickApiPutHandler(TABLE_NAME, updateList, SUBAREA_CREATE_CONFIG);
    await batchTransactData(command);

    return subarea;
  } catch (error) {
    throw new Exception('Error posting new subarea', { code: 400, error: error });
  }
}

async function getNextSubareaId(orcs) {
  // Get the next ID
  const subareas = await getSubareasByOrcs(orcs, { paginated: false });
  if (!subareas) {
    return 1;
  }
  const idArray = subareas.map((subarea) => parseInt(subarea?.sk));
  const nextId = Math.max(...idArray) + 1;
  return nextId;
}

// This action can only be used if both the subarea and facility objects are already created
// Only the subarea object can call thsi
async function updateFacilitySubareaLinks(orcs, facilitySkList, subareaId) {
  try {
    // get existing subarea object
    const subareaObj = await getSubareaById(orcs, subareaId);
    const existingFacilities = subareaObj?.facilities || [];

    // get the delta of facilities to add or remove
    const addFacilitiesSks = facilitySkList.filter((facility) => !existingFacilities.includes(facility));
    const removeFacilitiesSks = existingFacilities.filter((facility) => !facilitySkList.includes(facility));

    // update the subarea object with the new facilities
    let subareaCommands = [
      {
        key: {
          pk: `subarea::${orcs}`,
          sk: subareaId
        },
        data: {
          facilities: facilitySkList
        }
      }
    ];

    // there should be no overlap between add and remove lists for facilities, so we can do both actions in the same batch transaction
    // facilities can only belong to one subarea
    let facilitiesCommands = [];
    if (addFacilities.length) {
      for (const facilitySk of addFacilitiesSks) {
        facilitiesCommands.push({
          key: {
            pk: `facility::${orcs}`,
            sk: facilitySk
          },
          data: {
            subarea: `subarea::${orcs}#${subareaId}`
          }
        });
      }
    }
    if (removeFacilities.length) {
      for (const facilitySk of removeFacilitiesSks) {
        facilitiesCommands.push({
          key: {
            pk: `facility::${orcs}`,
            sk: facilitySk
          },
          data: {
            subarea: null
          }
        });
      }
    }
    let updateCommands = await quickApiUpdateHandler(TABLE_NAME, subareaCommands, SUBAREA_UPDATE_CONFIG);
    if (facilitiesCommands.length) {
      updateCommands = updateCommands.concat(await quickApiUpdateHandler(TABLE_NAME, facilitiesCommands, FACILITY_UPDATE_CONFIG));
    }
    console.log('updateCommands:', updateCommands);
    return await batchTransactData(updateCommands);
  } catch (error) {
    throw new Exception('Error updating subarea links to facility', { code: 400, error: error });
  }
}

async function putSubarea(orcs, subareaId, body) {
  logger.info('Put Subarea');
  try {
    let updateItem = {
      key: {
        pk: `subarea::${orcs}`,
        sk: subareaId
      },
      data: body,
    };
    let putCommand = await quickApiUpdateHandler(TABLE_NAME, [updateItem], SUBAREA_UPDATE_CONFIG);

    const res = await batchTransactData(putCommand);
    return res;
  } catch (error) {
    throw new Exception('Error putting subarea', { code: 400, error: error });
  }
}

async function deleteSubarea(orcs, subareaId) {
  logger.info('Delete Subarea');
  try {
    // check if there are any facilities linked to this subarea
    // for now, we will not allow deletion of subareas with linked items
    const facilites = await getFacilitiesBySubarea(orcs, subareaId);
    if (facilites.length) {
      let sks = facility.map((facility) => facility.sk);
      throw `Cannot delete subarea with linked facilities: ${sks.join(',\n')}`;
    }
    let deleteItem = {
      pk: `subarea::${orcs}`,
      sk: subareaId
    };
    let deleteCommand = await quickApiDeleteHandler(TABLE_NAME, deleteItem);
    const res = await batchTransactData(deleteCommand);
    return res;
  } catch (error) {
    throw new Exception('Error deleting subarea', { code: 400, error: error });
  }
}

module.exports = {
  deleteSubarea,
  getSubareasByOrcs,
  getSubareaById,
  postSubarea,
  putSubarea,
  updateFacilitySubareaLinks
};