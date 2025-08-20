const { rulesFns } = require('/opt/validation-rules');
const { POLICY_TYPE_ENUMS } = require('/opt/data-constants');

const rf = new rulesFns();

const POLICY_BOOKING_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    name: {
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
    checkInTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    checkOutTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    noShowTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    closeBookingTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    resWindowType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['rolling', 'fixed']);
        rf.expectAction(action, ['set']);
      }
    },
    rollingWindowDuration: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxStayNights: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    minStayNights: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    fixedWindowOpenDate: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    allDatesBookedIntervals: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value);
        rf.expectAction(action, ['set']);
        for (let item of value) {
          rf.expectISODateObjFormat(item);
        }
      }
    },
  }
};

const POLICY_CHANGE_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    name: {
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
    changeRestrictedDuration: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    areChangesAllowed: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    changeWindowDuration: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    isFeeWaivedInWindow: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    sameDayNightsForfeit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    inWindowNightsForfeit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const POLICY_FEE_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    name: {
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
    childNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectCurrency(value);
        rf.expectAction(action, ['set']);
      }
    },
    adultNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectCurrency(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitChangeFee: {
      rulesFn: ({ value, action }) => {
        rf.expectCurrency(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitReservationFee: {
      rulesFn: ({ value, action }) => {
        rf.expectCurrency(value);
        rf.expectAction(action, ['set']);
      }
    },
    baseChangeFee: {
      rulesFn: ({ value, action }) => {
        rf.expectCurrency(value);
        rf.expectAction(action, ['set']);
      }
    },
    isAcceptingPayment: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const POLICY_PARTY_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    name: {
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
    maxSize: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    minSize: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    minOccupantAge: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxVehicles: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxCanoePeople: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
  }
};

const POLICY_POST_MANDATORY_FIELDS = {
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
    policyType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, POLICY_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    policyId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    category: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        if (value !== 'policy') {
          throw new Exception('Invalid value: Expected category to be "policy"', { code: 400 });
        }
      }
    }
  }
};

const POLICY_API_UPDATE_CONFIGS = {
  booking: POLICY_BOOKING_API_UPDATE_CONFIG,
  change: POLICY_CHANGE_API_UPDATE_CONFIG,
  fee: POLICY_FEE_API_UPDATE_CONFIG,
  party: POLICY_PARTY_API_UPDATE_CONFIG,
};

const POLICY_API_CREATE_CONFIGS = (() => {
  let configs = {};
  for (const policyType of POLICY_TYPE_ENUMS) {
    let entry = { ...POLICY_API_UPDATE_CONFIGS[policyType] };
    entry.fields = { ...entry.fields, ...POLICY_POST_MANDATORY_FIELDS.fields, };
    configs[policyType] = entry;
  }
  return configs;
})();

module.exports = {
  POLICY_API_UPDATE_CONFIGS,
  POLICY_API_CREATE_CONFIGS,
};