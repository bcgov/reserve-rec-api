const { rulesFns } = require('/opt/validation-rules');
const { FACILITY_TYPE_ENUMS, TIMEZONE_ENUMS } = require('/opt/data-constants');

const rf = new rulesFns();

const ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "showOnMap", type: "boolean" },
  { name: "activities", type: "list" },
];

const FACILITY_API_PUT_CONFIG = {
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
    collectionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    orcs: {
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
        rf.expectValueInList(value, ['facility']),
          rf.expectAction(action, ['set']);
      }
    },
    facilityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, Object.keys(FACILITY_TYPE_ENUMS)),
          rf.expectAction(action, ['set']);
      }
    },
    facilitySubType: {
      rulesFn: ({ value, action }) => {
        // figure out how to shortlist these
        rf.expectValueInList(value, Object.values(FACILITY_TYPE_ENUMS).flat());
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
    address: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
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
    facilityId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    geozone: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    activities: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
    }
  },
  isVisible: {
    rulesFn: ({ value, action }) => {
      rf.expectType(value, ['boolean']);
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
  showOnMap: {
    isMandatory: true,
    rulesFn: ({ value, action }) => {
      rf.expectType(value, ['boolean']);
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
}

const FACILITY_API_UPDATE_CONFIG = {
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
    facilitySubType: {
      rulesFn: ({ value, action }) => {
        // figure out how to shortlist these
        rf.expectValueInList(value, Object.values(FACILITY_TYPE_ENUMS).flat());
        rf.expectAction(action, ['set']);
      }
    },
    location: {
      rulesFn: ({ value, action }) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['set']);
      }
    },
    address: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    identifier: {
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
        rf.expectAction(action, ['set']);
      }
    },
    geozone: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
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
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    timezone: {
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
    showOnMap: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
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
  FACILITY_API_PUT_CONFIG,
  FACILITY_API_UPDATE_CONFIG
};
