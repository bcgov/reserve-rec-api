const {
  getAllCollections,
  getCollectionByCollectionId,
} = require("../methods");
const { Exception, logger, sendResponse } = require("/opt/base");
const { ALLOWED_FILTERS } = require("../configs");

/**
 * @api {get} /collections GET
 * @api {get} /collections/{collectionId} GET
 * Fetch collections (public read)
 */
exports.handler = async (event, context) => {
  logger.info("GET collections (public)", event);

  if (event?.httpMethod === "OPTIONS") {
    return sendResponse(200, null, "Success", null, context);
  }

  try {
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

    // Always strip adminNotes for public consumers
    const removedFields = ({ adminNotes, ...allowedFields }) => allowedFields;
    if (Array.isArray(res)) {
      res = res.map(removedFields);
    } else if (res?.items) {
      res.items = res.items.map(removedFields);
    } else if (res) {
      res = removedFields(res);
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
