const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const TIMEZONE_ENUMS = ['America/Vancouver', 'America/Edmonton', 'America/Fort_Nelson', 'America/Creston']

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
          rf.expectGeopoint(value);
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
    },
    version: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    creationDate: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    lastUpdated: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    }
  }
}

module.exports = {
  PROTECTED_AREA_API_UPDATE_CONFIG
}
