const { rulesFns } = require('../../common/validation-rules');
const { ACTIVITY_TYPE_ENUMS, SUB_ACTIVITY_TYPE_ENUMS } = require('../../common/data-constants');

const rf = new rulesFns();

const ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "activityType", type: "list" },
  { name: "productId", type: "string" },
];

const PRODUCT_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
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
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['product']);
        rf.expectAction(action, ['set']);
      }
    },
    globalId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    collectionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    productId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    identifier: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    activityId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    activityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ACTIVITY_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    activitySubType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, SUB_ACTIVITY_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    displayName: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    description: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    rangeStart: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value)
        rf.expectAction(action, ['set']);
      }
    },
    rangeEnd: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value)
        rf.expectAction(action, ['set']);
      }
    },
    timezone: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    minStay: {
      rulesFn: ({ value, action }) => {
        rf.expectTemporalDuration(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxStay: {
      rulesFn: ({ value, action }) => {
        rf.expectTemporalDuration(value);
        rf.expectAction(action, ['set']);
      }
    },
    assets: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
      }
    },
    isReservable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isChangeable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isCancellable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const PRODUCT_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    displayName: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    description: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    schema: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['product']);
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    bookingPolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    changePolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    partyPolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    feePolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    capacity: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    price: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    geozones: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
      }
    },
    facilities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
      }
    },
    activities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const PRODUCT_DEFAULT_PROPERTY_NAMES = [
  'searchTerms',
  'displayName',
  'description',
  'imageUrl',
]

const PRODUCT_DAILY_PROPERTIES_CONFIG = {
  allowOverwrite: true,
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
}

const PRODUCT_DEFAULT_SCHEDULE_RANGE = {
  weeks: 2,
}

module.exports = {
  ALLOWED_FILTERS,
  PRODUCT_API_PUT_CONFIG,
  PRODUCT_API_UPDATE_CONFIG,
  PRODUCT_DEFAULT_SCHEDULE_RANGE,
  PRODUCT_DAILY_PROPERTIES_CONFIG,
  PRODUCT_DEFAULT_PROPERTY_NAMES,
}
