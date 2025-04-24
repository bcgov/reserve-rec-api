const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const TIMEZONE_ENUMS = ['America/Vancouver', 'America/Edmonton', 'America/Fort_Nelson', 'America/Creston'];

const ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "activities", type: "list" },
  { name: "facilities", type: "list" }
];

const GEOZONE_API_PUT_CONFIG = {
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
    gzCollectionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    orcs: {
      isMandatory: true,
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
        rf.expectValueInList(value, ['geozone']),
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
    geozoneId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    location: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['set']);
      }
    },
    envelope: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectEnvelope(value);
        rf.expectAction(action, ['set']);
      }
    },
    timezone: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TIMEZONE_ENUMS);
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
    minMapZoom: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxMapZoom: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
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
    },
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
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
    location: {
      rulesFn: ({ value, action }) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['set']);
      }
    },
    envelope: {
      rulesFn: ({ value, action }) => {
        rf.expectEnvelope(value);
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
    },
    imageUrl: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
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
  ALLOWED_FILTERS,
  GEOZONE_API_PUT_CONFIG,
  GEOZONE_API_UPDATE_CONFIG
};
