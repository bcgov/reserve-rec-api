const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "activityType", type: "list" },
  { name: "subActivityType", type: "list" },
  { name: "facilities", type: "list" }
];

const SUB_ACTIVITY_TYPE_ENUMS = [
  'campsite',
  'walkin',
  'rv',
  'reservation',
  'passport',
  'vehicleParking',
  'trailUse',
  'shelterUse',
  'saniUse',
  'showerUse',
  'elecUse',
  'dockMooring',
  'buoyMooring',
  'frontcountry',
  'backcountry',
  'portionCircuit',
  'fullCircuit',
];
const ACTIVITY_TYPE_ENUMS = [
  'frontcountryCamp',
  'backcountryCamp',
  'groupCamp',
  'dayuse',
  'boating',
  'cabinStay',
  'canoe'
];


const ACTIVITY_API_PUT_CONFIG = {
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
    orcs: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
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
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['activity']),
        rf.expectAction(action, ['set']);
      }
    },
    activityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ACTIVITY_TYPE_ENUMS),
        rf.expectAction(action, ['set']);
      }
    },
    activitySubType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, SUB_ACTIVITY_TYPE_ENUMS),
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
    geozone: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    facilities: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      isMandatory: true,
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
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const ACTIVITY_API_UPDATE_CONFIG = {
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
        rf.expectValueInList(value, ['activity']),
          rf.expectAction(action, ['set']);
      }
    },
    activityType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ACTIVITY_TYPE_ENUMS),
          rf.expectAction(action, ['set']);
      }
    },
    activitySubType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, SUB_ACTIVITY_TYPE_ENUMS),
          rf.expectAction(action, ['set']);
      }
    },
    identifier: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    activityId: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    geozone: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    facilities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
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
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

module.exports = {
  ACTIVITY_API_PUT_CONFIG,
  ACTIVITY_API_UPDATE_CONFIG,
  ALLOWED_FILTERS
};
