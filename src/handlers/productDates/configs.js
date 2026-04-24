const { rulesFns } = require('../../common/validation-rules');
const { ACTIVITY_TYPE_ENUMS, SUB_ACTIVITY_TYPE_ENUMS } = require('../../common/data-constants');

const rf = new rulesFns();

const ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "activityType", type: "list" },
  { name: "productId", type: "string" },
];

const PUBLIC_PRODUCTDATE_PROJECTIONS = [
  "pk",
  "sk",
  "collectionId",
  "assetList",
  "activityType",
  "activityId",
  "productId",
  "date",
  "displayName",
  "reservationContext",
  "version",
  "schema"
]

// TODO complete later (remove developerMode)
const PRODUCTDATE_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  developerMode: true,
  autoGlobalId: true,
  fields: {
    pk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    sk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
  }
};

// TODO complete later (remove developerMode)
const AVAILABILITYSIGNAL_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  developerMode: true,

  fields: {
    pk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    sk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

module.exports = {
  PRODUCTDATE_API_PUT_CONFIG,
  AVAILABILITYSIGNAL_API_PUT_CONFIG,
  PUBLIC_PRODUCTDATE_PROJECTIONS,
};