const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const MAP_ZOOM_MIN = 0;
const MAP_ZOOM_MAX = 22;

const sharedFieldsRules = {
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
  location: {
    rulesFn: ({ value, action }) => {
      rf.expectGeopoint(value);
      rf.expectAction(action, ['set']);
    }
  },
  address: {
    rulesFn: ({ value, action }) => {
      rf.expectString(value);
      rf.expectAction(action, ['set']);
    }
  },
  minMapZoom: {
    rulesFn: ({ value, action }) => {
      rf.expectInteger(value);
      rf.expectInRange(value, MAP_ZOOM_MIN, MAP_ZOOM_MAX, true, 'minimum map zoom');
      rf.expectAction(action, ['set']);
    }
  },
  maxMapZoom: {
    rulesFn: ({ value, action }) => {
      rf.expectInteger(value);
      rf.expectInRange(value, MAP_ZOOM_MIN, MAP_ZOOM_MAX, true, 'maximum map zoom');
      rf.expectAction(action, ['set']);
    }
  },
  imageUrl: {
    rulesFn: ({ value, action }) => {
      rf.expectString(value);
      rf.expectAction(action, ['set']);
    }
  }
};

const FACILITY_CREATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    ...sharedFieldsRules,
    pk: {
      isMandatory: true,
    },
    sk: {
      isMandatory: true,
    },
    orcs: {
      isMandatory: true,
    },
    identifier: {
      isMandatory: true,
    },
    schema: {
      isMandatory: true,
    },
    facilityType: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectString(value);
        rf.expectAction(action, ['set']);
      }
    },
    timeZone: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectString(value);
        rf.expectAction(action, ['set']);
      }
    },
  }
};

const FACILITY_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  enforceSerialUpdates: true,
  fields: sharedFieldsRules
};

module.exports = {
  FACILITY_CREATE_CONFIG,
  FACILITY_UPDATE_CONFIG
}