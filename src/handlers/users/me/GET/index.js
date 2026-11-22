const { sendResponse, logger, adminContext } = require('/opt/base');
const { getOne } = require('/opt/dynamodb');

// GET /users/me
// Returns the calling user's sub, permissions and role. Park Operator and Park Staff also get
// their facilities: the keys the authorizer allowed, named from their operator record (#682).
exports.handler = async function (event, context) {
  logger.debug('User GET /me', JSON.stringify(event));

  let caller;
  try {
    // adminContext also covers local SAM runs, where no authorizer context is injected
    caller = adminContext(event);
  } catch {
    // A malformed context grants nothing; the app reads empty permissions as "pending access"
    caller = { sub: event?.requestContext?.authorizer?.principalId, permissions: {}, role: null, facilities: null };
  }

  try {
    const { sub, permissions, role, facilities } = caller;
    const data = { sub: sub || null, permissions, role };

    if (facilities) {
      const operatorId = event?.requestContext?.authorizer?.operatorId;
      let named = {};
      try {
        named = (await getOne(`operator::${operatorId}`, 'base'))?.facilities || {};
      } catch (error) {
        // Names are a nicety; the keys still come from the authorizer
        logger.warn('Could not read the operator record for /users/me', { operatorId, error: error?.message });
      }
      data.facilities = facilities.map((key) => ({
        key,
        orcs: named[key]?.orcs ?? null,
        displayName: named[key]?.displayName ?? null,
      }));
    }

    return sendResponse(200, data, 'User retrieved successfully', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 500, null, error?.msg || 'Error', null, context);
  }
};
