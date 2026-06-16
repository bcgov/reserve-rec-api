const {
  getAllCollections,
  getCollectionByCollectionId,
} = require("../methods");
const { Exception, logger, sendResponse, checkAuthContext } = require("/opt/base");
const { ALLOWED_FILTERS } = require("../configs");

/**
 * @api {get} /collections GET
 * @api {get} /collections/{collectionId} GET
 * Fetch collections
 */
exports.handler = async (event, context) => {
  logger.info("GET collections", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
    const authContext = checkAuthContext(event);

    const collectionId = event?.pathParameters?.collectionId || null;
    const queryParams = event?.queryStringParameters || {};

    let filters = {};
    ALLOWED_FILTERS.forEach((filter) => {
      if (queryParams[filter.name]) {
        filters[filter.name] =
          queryParams[filter.name] === "true"
            ? true
            : queryParams[filter.name] === "false"
            ? false
            : queryParams[filter.name];
      }
    });

    let res = null;

    if (collectionId) {
      res = await getCollectionByCollectionId(collectionId);
      if (!res) {
        throw new Exception("Collection not found", { code: 404 });
      }
    } else {
      res = await getAllCollections(filters, queryParams);
    }

    const isSuperAdmin = authContext.permissions?.['superadmin'] === 'superadmin';

    // If the user isn't a superadmin, remove adminNotes from the response
    if (res && !isSuperAdmin) {
      const removedFields = ({ adminNotes, ...allowedFields }) => allowedFields;
      if (Array.isArray(res)) {
        res = res.map(removedFields);
      } else if (res?.items) {
        res.items = res.items.map(removedFields);
      } else {
        res = removedFields(res);
      }
    }

    // Filter out the collections the user doesn't have (at least) the 'staff' permission for
    if (!isSuperAdmin && res) {
      const TIER_ORDER = ['limited', 'staff', 'superadmin'];
      const minTierIndex = TIER_ORDER.indexOf('staff');
      const hasAtLeastStaff = (collectionId) => {
        const tier = authContext.permissions?.[collectionId];
        return TIER_ORDER.indexOf(tier) >= minTierIndex;
      };

      const filterCollections = (items) => items.filter((c) => hasAtLeastStaff(c.collectionId));

      if (Array.isArray(res)) {
        res = filterCollections(res);
      } else if (res?.items) {
        res.items = filterCollections(res.items);
      }
      // Single-collection fetch: already guarded by checkAuthContext upstream
    }


    return sendResponse(200, res, "Success", null, context);
  } catch (error) {
    return sendResponse(
      Number(error?.code) || 400,
      error?.data || null,
      error?.message || "Error",
      error?.error || error,
      context
    );
  }
};
