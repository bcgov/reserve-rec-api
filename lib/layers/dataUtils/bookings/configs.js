const { rulesFns } = require('/opt/validation-rules');
const { ACTIVITY_TYPE_ENUMS, BOOKING_STATUS_ENUMS, SUB_ACTIVITY_TYPE_ENUMS, TIMEZONE_ENUMS, PARTY_AGE_CATEGORY_ENUMS, RATE_CLASS_ENUMS } = require('/opt/data-constants');

const rf = new rulesFns();

const BOOKING_PUT_CONFIG = {
  failOnError: true,
  autoTimeStamp: true,
  autoVersion: true,
  allowOverwrite: false,
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
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['booking']);
        rf.expectAction(action, ['set']);
      }
    },
    globalId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    bookingId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    startDate: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    endDate: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value);
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
    bookedAt: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectISODateTimeObjFormat(value);
        rf.expectAction(action, ['set']);
      }
    },
    user: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    acCollectionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    activityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ACTIVITY_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    activitySubType: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, SUB_ACTIVITY_TYPE_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    activityId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string', 'number']);
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
    partyInformation: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        rf.expectAction(action, ['set']);
      },
      fields: {
        adult: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectInteger(value);
            rf.expectAction(action, ['set']);
          }
        },
        child: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectInteger(value);
            rf.expectAction(action, ['set']);
          }
        },
        senior: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectInteger(value);
            rf.expectAction(action, ['set']);
          }
        },
        youth: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectInteger(value);
            rf.expectAction(action, ['set']);
          }
        }
      }
    },
    rateClass: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, RATE_CLASS_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    namedOccupant: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        rf.expectAction(action, ['set']);
      },
      fields: {
        firstName: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        },
        lastName: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        },
        age: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectInteger(value);
            rf.expectAction(action, ['set']);
          }
        },
        contactInfo: {
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['object']);
            rf.expectObjectToHaveMinNumberOfProperties(value, ['email', 'phone'], 1);
            rf.expectAction(action, ['set']);
          },
          fields: {
            email: {
              rulesFn: ({ value, action }) => {
                rf.expectEmailFormat(value);
                rf.expectAction(action, ['set']);
              }
            },
            phone: {
              rulesFn: ({ value, action }) => {
                rf.expect10DigitPhoneFormat(value);
                rf.expectAction(action, ['set']);
              }
            }
          }
        }
      }
    },
    vehicleInformation: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        rf.expectAction(action, ['set']);
      },
      fields: {
        licensePlate: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        },
        licensePlateRegistrationRegion: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        },
        vehicleMake: {
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        },
        vehicleModel: {
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        },
        vehicleColour: {
          rulesFn: ({ value, action }) => {
            rf.expectType(value, ['string']);
            rf.expectAction(action, ['set']);
          }
        }
      }
    },
    equipmentInformation: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    feeInformation: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        rf.expectAction(action, ['set']);
      },
      fields: {
        registrationFees: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectMoneyFormat(value, ['number']);
            rf.expectAction(action, ['set']);
          }
        },
        transactionFees: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectMoneyFormat(value, ['number']);
            rf.expectAction(action, ['set']);
          }
        },
        tax: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectMoneyFormat(value, ['number']);
            rf.expectAction(action, ['set']);
          }
        },
        total: {
          isMandatory: true,
          rulesFn: ({ value, action }) => {
            rf.expectMoneyFormat(value, ['number']);
            rf.expectAction(action, ['set']);
          }
        },
      }
    },
    bookingStatus: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, BOOKING_STATUS_ENUMS);
        rf.expectAction(action, ['set']);
      }
    },
    entryPoint: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    exitPoint: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
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
    adminNotes: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

module.exports = {
  BOOKING_PUT_CONFIG
};