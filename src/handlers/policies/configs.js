const { rulesFns } = require('../../common/validation-rules');
const { POLICY_TYPE_ENUMS, POLICY_BOOKING_RESERVATION_WINDOW_TYPE_ENUMS, PARTY_UNIT_TYPE_ENUMS } = require('../../common/data-constants');

const rf = new rulesFns();

const POLICY_BOOKING_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
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
    displayName: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    description: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['policy']);
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
    identifier: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    minStay: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxStay: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    reservationWindowType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, POLICY_BOOKING_RESERVATION_WINDOW_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    rollingWindowOpenDuration: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    rollingWindowCloseDuration: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    fixedWindowLaunchDate: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    reservationOpeningTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    reservationClosingTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
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
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    allDatesBookedIntervals: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['array']);
        rf.expectAction(action, ['set']);
        for (const interval of value) {
          rf.expectType(interval, ['array']);
          for (const dateStr of interval) {
            rf.expectISODateString(dateStr);
          }
        }
      }
    },
    creationDate: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    lastUpdated: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    globalId: {
      // we only care that this is allowed to be set; value is ignored
      // (autoGlobalId will set it appropriately)
    }
  }
};

const POLICY_BOOKING_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  fields: {
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
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
    minStay: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxStay: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    reservationWindowType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, POLICY_BOOKING_RESERVATION_WINDOW_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    rollingWindowDuration: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    fixedWindowLaunchDate: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    openBookingTime: {
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
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    allDatesBookedIntervals: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['array']);
        rf.expectAction(action, ['set']);
        for (const interval of value) {
          rf.expectType(interval, ['array']);
          for (const dateStr of interval) {
            rf.expectISODateString(dateStr);
          }
        }
      }
    }
  }
};

const POLICY_CHANGE_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
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
        rf.expectValueInList(value, ['policy']);
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
    identifier: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
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
    changeInWindowNightsForfeit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    changeSameDayNightsForfeit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    isChangeFeeWaivedInWindow: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    changesAcceptedUntilTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    cancellationsAcceptedUntilTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    restrictedWindowDuration: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    creationDate: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    lastUpdated: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    globalId: {
      // we only care that this is allowed to be set; value is ignored
      // (autoGlobalId will set it appropriately)
    }
  }
};

const POLICY_CHANGE_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  fields: {
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
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
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
    changeInWindowNightsForfeit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    changeSameDayNightsForfeit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    isChangeFeeWaivedInWindow: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    changesAcceptedUntilTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    cancellationsAcceptedUntilTime: {
      rulesFn: ({ value, action }) => {
        rf.expect24hTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    restrictedWindowDuration: {
      rulesFn: ({ value, action }) => {
        rf.expectDurationObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const POLICY_PARTY_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
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
        rf.expectValueInList(value, ['policy']);
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
    identifier: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    minOccupantAge: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    minSize: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSize: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxUnitsPerBooking: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitType: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, PARTY_UNIT_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    maxAdultsTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxYouthTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxChildTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSeniorTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxAdultsPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxYouthPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxChildPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSeniorPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSizePerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxVehiclesPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    mustProvideAccessPoints: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    creationDate: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    lastUpdated: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    globalId: {
      // we only care that this is allowed to be set; value is ignored
      // (autoGlobalId will set it appropriately)
    }
  }
};

const POLICY_PARTY_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
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
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    minOccupantAge: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    minSize: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSize: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxUnitsPerBooking: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, PARTY_UNIT_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    maxAdultsTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxYouthTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxChildTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSeniorTotal: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxAdultsPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxYouthPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxChildPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSeniorPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxSizePerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxVehiclesPerUnit: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    mustProvideAccessPoints: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const POLICY_FEE_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
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
        rf.expectValueInList(value, ['policy']);
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
    identifier: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    isAcceptingPayments: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      },
    },
    adultNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    youthNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    childNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    seniorNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    baseChangeFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitChangeFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    baseReservationFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitReservationFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitType: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, PARTY_UNIT_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    maxUnitCharge: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    changeSSCFECharge: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    hasSSCFEDiscount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    additionalVehiclesFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    damageDeposit: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    hasSeniorsDiscount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    feeRegisterKey: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectPrimaryKey(value);
        rf.expectAction(action, ['set']);
      }
    },
    creationDate: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    lastUpdated: {
      // we only care that this is allowed to be set; value is ignored
      // (autoTimestamp will set it appropriately)
    },
    globalId: {
      // we only care that this is allowed to be set; value is ignored
      // (autoGlobalId will set it appropriately)
    }
  }
};

const POLICY_FEE_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
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
    policyIdVersion: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['number']);
        rf.expectAction(action, ['set']);
      }
    },
    isAcceptingPayments: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      },
    },
    adultNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    youthNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    childNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    seniorNightlyCampingFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    baseChangeFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitChangeFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    baseReservationFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitReservationFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    unitType: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, PARTY_UNIT_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    maxUnitCharge: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    changeSSCFECharge: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    hasSSCFEDiscount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    additionalVehiclesFee: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    damageDeposit: {
      rulesFn: ({ value, action }) => {
        rf.expectNumber(value);
        rf.expectAction(action, ['set']);
      }
    },
    hasSeniorsDiscount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    feeRegisterKey: {
      allowEmpty: true,
      rulesFn: ({ value, action }) => {
        rf.expectPrimaryKey(value);
        rf.expectAction(action, ['set']);
      }
    },
  }
};

module.exports = {
  POLICY_BOOKING_API_PUT_CONFIG,
  POLICY_BOOKING_API_UPDATE_CONFIG,
  POLICY_CHANGE_API_PUT_CONFIG,
  POLICY_CHANGE_API_UPDATE_CONFIG,
  POLICY_PARTY_API_PUT_CONFIG,
  POLICY_PARTY_API_UPDATE_CONFIG,
  POLICY_FEE_API_PUT_CONFIG,
  POLICY_FEE_API_UPDATE_CONFIG
};
