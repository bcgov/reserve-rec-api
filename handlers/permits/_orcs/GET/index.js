/**
 * Get Permits
 */

const { Exception, sendResponse, logger } = require('/opt/base');
const { getPermit, getPermits } = require('/opt/permits/methods');

exports.handler = async (event, context) => {
  logger.info('Get Permits', event);

  try {

    const orcs = event?.pathParameters?.orcs || null;

    if (!orcs) {
      throw new Exception('ORCS is required', { code: 400 });
    }

    const permitType = event?.pathParameters?.permitType || event?.queryStringParameters?.permitType || null;
    const identifier = event?.pathParameters?.identifier || event?.queryStringParameters?.identifier || null;
    const startDate = event?.queryStringParameters?.startDate || null;
    const endDate = event?.queryStringParameters?.endDate || null;

    if (!permitType && identifier) {
      throw new Exception('PermitType is required when searching by identifier', { code: 400 });
    }

    if (startDate && (!permitType || !identifier)) {
      throw new Exception('Permit type and identifier are required when getting permits on dates', { code: 400 });
    }

    let permits = null;

    if (startDate) {
      permits = await getPermit(orcs, permitType, identifier, startDate, endDate);
    } else {
      permits = await getPermits(orcs, permitType, identifier);
    }

    return sendResponse(200, permits, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};