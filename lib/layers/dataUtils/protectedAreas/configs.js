const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const TIMEZONE_ENUMS = ['America/Vancouver', 'America/Edmonton', 'America/Fort_Nelson', 'America/Creston']

const PROTECTED_AREA_API_PUT_CONFIG = {
  allowOverwrite: true,
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
    schema : {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['protectedArea']),
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
    boundary: {
      isMandatory: true,
        rulesFn: ({value, action}) => {
          rf.expectGeoshape(value);
          rf.expectAction(action, ['add']);
        }
      },
    boundaryUrl: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    },
    timezone : {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TIMEZONE_ENUMS);
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
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['add']);
      }
    }
  }
}

const PROTECTED_AREA_API_UPDATE_CONFIG = {
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
    schema : {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['protectedArea']),
        rf.expectAction(action, ['set']);
      }
    },
    location: {
        rulesFn: ({value, action}) => {
          rf.expectGeopoint(value);
          rf.expectAction(action, ['set']);
        }
      },
    boundary: {
        rulesFn: ({value, action}) => {
          rf.expectGeoshape(value);
          rf.expectAction(action, ['set']);
        }
      },
    boundaryUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    timezone : {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TIMEZONE_ENUMS);
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
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
}

module.exports = {
  PROTECTED_AREA_API_PUT_CONFIG,
  PROTECTED_AREA_API_UPDATE_CONFIG
}
