const { rulesFns } = require('../../common/validation-rules');
const rf = new rulesFns();

// TODO: turn off developerMode and properly vet incoming data.
const INVENTORYPOOLS_API_PUT_CONFIG = {
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


const INVENTORYPOOLS_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  developerMode: true,
  fields: {
    capacity: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectMin(value, 0);
        rf.expectAction(action, ['set']);
      }
    },
    availability: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectMin(value, 0);
        rf.expectAction(action, ['set']);
      }
    },
  }
};

module.exports = {
  INVENTORYPOOLS_API_PUT_CONFIG,
  INVENTORYPOOLS_API_UPDATE_CONFIG,
};