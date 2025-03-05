const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const TIMEZONE_ENUMS = ['America/Vancouver', 'America/Edmonton', 'America/Fort_Nelson', 'America/Creston']

const GEOZONE_API_PUT_CONFIG = {
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
    gzCollectionId: {
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
        rf.expectValueInList(value, ['geozone']),
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
    geozoneId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['add']);
      }
    },
    location: {
      isMandatory: true,
      rulesFn: ({value, action}) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['add']);
      }
    },
    envelope: {
      isMandatory: true,
      rulesFn: ({value, action}) => {
        rf.expectGeoshape(value);
        rf.expectAction(action, ['add']);
      }
    },
    timezone: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TIMEZONE_ENUMS);
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
    minMapZoom: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['add']);
      }
    },
    maxMapZoom: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['add']);
      }
    },
    facilities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    activities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    }
  }
}

const GEOZONE_API_UPDATE_CONFIG = {
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
        rf.expectValueInList(value, ['geozone']),
        rf.expectAction(action, ['set']);
      }
    },
    identifier: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    geozoneId: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    location: {
      rulesFn: ({value, action}) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['set']);
      }
    },
    envelope: {
      rulesFn: ({value, action}) => {
        rf.expectGeoshape(value);
        rf.expectAction(action, ['set']);
      }
    },
    timezone: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TIMEZONE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    minMapZoom: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxMapZoom: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    facilities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    activities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
}

module.exports = {
  GEOZONE_API_PUT_CONFIG,
  GEOZONE_API_UPDATE_CONFIG
}
