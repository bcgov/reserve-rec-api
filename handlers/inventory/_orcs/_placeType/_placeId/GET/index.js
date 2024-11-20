/**
 * Get Inventory
 */

const { Exception, sendResponse, logger } = require('/opt/base');
const { getInventory } = require('/opt/inventory/methods');

exports.handler = async (event, context) => {
  logger.info('Get Inventory', event);

  try {

    const orcs = event?.pathParameters?.orcs || null;
    const placeType = event?.pathParameters?.placeType || null;
    const placeId = event?.pathParameters?.placeId || null;

    if (!orcs || !placeType || !placeId) {
      throw new Exception('ORCS, placeType and placeId are required', { code: 400 });
    }

    const inventoryType = event?.pathParameters?.inventoryType || event?.queryStringParameters?.inventoryType || null;
    const identifier = event?.pathParameters?.identifier || event?.queryStringParameters?.identifier || null;

    if (!inventoryType && identifier) {
      throw new Exception('InventoryType is required when searching by identifier', { code: 400 });
    }

    let inventory = await getInventory(orcs, placeType, placeId, inventoryType, identifier);

    return sendResponse(200, inventory, 'Success', null, context);
  } catch (error) {
    return sendResponse(Number(error?.code) || 400, error?.data || null, error?.message || 'Error', error?.error || null, context);
  }
};