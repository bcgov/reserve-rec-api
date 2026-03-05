const INVENTORY_ALLOCATION_STATUSES = {
  AVAILABLE: 'available',
  HELD: 'held',
  RESERVED: 'reserved',
  RELEASING: 'releasing',
};

// TODO: turn off developerMode and properly vet incoming data.
const INVENTORY_API_PUT_CONFIG = {
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
  INVENTORY_ALLOCATION_STATUSES,
  INVENTORY_API_PUT_CONFIG,
};