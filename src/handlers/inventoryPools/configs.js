
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

module.exports = {
  INVENTORYPOOLS_API_PUT_CONFIG,
};