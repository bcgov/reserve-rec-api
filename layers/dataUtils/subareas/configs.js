const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const SUBAREA_CREATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
}

const SUBAREA_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  enforceSerialUpdates: true,
  fields: {
    displayName: {
      rulesFn: ({ value, action }) => {
        rf.expectString(value);
        rf.expectAction(action, ['set']);
      }
    },
    description: {
      rulesFn: ({ value, action }) => {
        rf.expectString(value);
        rf.expectAction(action, ['set']);
      }
    },
    version: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectBoolean(value);
        rf.expectAction(action, ['set']);
      }
    },
    activities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value);
        rf.expectAction(action, ['set']);
      }
    },
    facilities: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value);
        rf.expectAction(action, ['set']);
      }
    },
    envelope: {
      rulesFn: ({ value, action }) => {
        rf.expectGeoEnvelope(value);
        rf.expectAction(action, ['set']);
      }
    },
    location: {
      rulesFn: ({ value, action }) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['set']);
      }
    },
  }
}

module.exports = {
  SUBAREA_CREATE_CONFIG,
  SUBAREA_UPDATE_CONFIG
};