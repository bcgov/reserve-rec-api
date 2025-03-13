const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

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
]
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
        rf.expectAction(action, ['add']);
      }
    },
    sk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    orcs: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['add']);
      }
    },
    displayName: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    description: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['activity']),
        rf.expectAction(action, ['add']);
      }
    },
    activityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ACTIVITY_TYPE_ENUMS),
        rf.expectAction(action, ['add']);
      }
    },
    subActivityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, SUB_ACTIVITY_TYPE_ENUMS),
        rf.expectAction(action, ['add']);
      }
    },
    identifier: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['add']);
      }
    },
    activityId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['add']);
      }
    },
    geozone: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    facilities: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    isVisible: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['add']);
      }
    },
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    searchTerms: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    }
  }
}

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
    subActivityType: {
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
        rf.expectArray(value, ['string']);
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
    }
  }
}

module.exports = {
  ACTIVITY_API_PUT_CONFIG,
  ACTIVITY_API_UPDATE_CONFIG
}
