const { rulesFns } = require('../../common/validation-rules');
const { ACTIVITY_TYPE_ENUMS, SUB_ACTIVITY_TYPE_ENUMS } = require('../../common/data-constants');

const rf = new rulesFns();

const ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "activityType", type: "list" },
  { name: "productId", type: "string" },
];

const PRODUCT_API_PUT_CONFIG = {
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
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ['product']);
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
    collectionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    productId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
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
    activityId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectInteger(value);
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
    rangeStart: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value)
        rf.expectAction(action, ['set']);
      }
    },
    rangeEnd: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value)
        rf.expectAction(action, ['set']);
      }
    },
    timezone: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    minStay: {
      rulesFn: ({ value, action }) => {
        rf.expectTemporalDuration(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxStay: {
      rulesFn: ({ value, action }) => {
        rf.expectTemporalDuration(value);
        rf.expectAction(action, ['set']);
      }
    },
    assets: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
      }
    },
    assetList: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        // Validate each AssetRef has required fields
        value.forEach(assetRef => {
          if (!assetRef.primaryKey) {
            throw new Error('AssetRef must include primaryKey');
          }
          rf.expectPrimaryKey(assetRef.primaryKey);
          if (!assetRef.allocationType) {
            throw new Error('AssetRef must include allocationType');
          }
          if (!['fixed', 'flex'].includes(assetRef.allocationType)) {
            throw new Error('AssetRef allocationType must be "fixed" or "flex"');
          }
          if (!assetRef.quantity || typeof assetRef.quantity !== 'number') {
            throw new Error('AssetRef must include numeric quantity');
          }
        });
        rf.expectAction(action, ['set']);
      }
    },
    availabilityEstimationPattern: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        if (!value.estimationMode) {
          throw new Error('availabilityEstimationPattern must include estimationMode');
        }
        if (!['exact', 'tiered'].includes(value.estimationMode)) {
          throw new Error('estimationMode must be "exact" or "tiered"');
        }
        if (!value.cadence || typeof value.cadence !== 'object') {
          throw new Error('availabilityEstimationPattern must include cadence object');
        }
        if (value.estimationMode === 'tiered' && !value.tiers) {
          throw new Error('tiered estimationMode requires tiers array');
        }
        rf.expectAction(action, ['set']);
      }
    },
    waitRoomConfig: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        rf.expectAction(action, ['set']);
      }
    },
    allDatesReservedIntervals: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        // Validate each DateInterval
        value.forEach(interval => {
          if (!interval.id || !interval.label || !interval.startDate || !interval.endDate) {
            throw new Error('DateInterval must include id, label, startDate, and endDate');
          }
        });
        rf.expectAction(action, ['set']);
      }
    },
    isReservable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isChangeable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isCancellable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    reservationPolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format - will be resolved by handler
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('reservationPolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set']);
      }
    },
    partyPolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format - will be resolved by handler
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('partyPolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set']);
      }
    },
    feePolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format - will be resolved by handler
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('feePolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set']);
      }
    },
    changePolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format - will be resolved by handler
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('changePolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    passesRequired: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    qrCodeEnabled: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
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

const PRODUCT_API_UPDATE_CONFIG = {
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
    rangeStart: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value)
        rf.expectAction(action, ['set']);
      }
    },
    rangeEnd: {
      rulesFn: ({ value, action }) => {
        rf.expectISODateObjFormat(value)
        rf.expectAction(action, ['set']);
      }
    },
    timezone: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    minStay: {
      rulesFn: ({ value, action }) => {
        rf.expectTemporalDuration(value);
        rf.expectAction(action, ['set']);
      }
    },
    maxStay: {
      rulesFn: ({ value, action }) => {
        rf.expectTemporalDuration(value);
        rf.expectAction(action, ['set']);
      }
    },
    assets: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        value.map(v => rf.expectPrimaryKey(v));
        rf.expectAction(action, ['set']);
      }
    },
    assetList: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        // Validate each AssetRef has required fields
        value.forEach(assetRef => {
          if (!assetRef.primaryKey) {
            throw new Error('AssetRef must include primaryKey');
          }
          rf.expectPrimaryKey(assetRef.primaryKey);
          if (!assetRef.allocationType) {
            throw new Error('AssetRef must include allocationType');
          }
          if (!['fixed', 'flex'].includes(assetRef.allocationType)) {
            throw new Error('AssetRef allocationType must be "fixed" or "flex"');
          }
          if (!assetRef.quantity || typeof assetRef.quantity !== 'number') {
            throw new Error('AssetRef must include numeric quantity');
          }
        });
        rf.expectAction(action, ['set']);
      }
    },
    availabilityEstimationPattern: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        if (!value.estimationMode) {
          throw new Error('availabilityEstimationPattern must include estimationMode');
        }
        if (!['exact', 'tiered'].includes(value.estimationMode)) {
          throw new Error('estimationMode must be "exact" or "tiered"');
        }
        if (!value.cadence || typeof value.cadence !== 'object') {
          throw new Error('availabilityEstimationPattern must include cadence object');
        }
        if (value.estimationMode === 'tiered' && !value.tiers) {
          throw new Error('tiered estimationMode requires tiers array');
        }
        rf.expectAction(action, ['set']);
      }
    },
    waitRoomConfig: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        rf.expectAction(action, ['set']);
      }
    },
    allDatesReservedIntervals: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['object']);
        // Validate each DateInterval
        value.forEach(interval => {
          if (!interval.id || !interval.label || !interval.startDate || !interval.endDate) {
            throw new Error('DateInterval must include id, label, startDate, and endDate');
          }
        });
        rf.expectAction(action, ['set']);
      }
    },
    isReservable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isChangeable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isCancellable: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    isVisible: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    searchTerms: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    adminNotes: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    reservationPolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('reservationPolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set', 'remove']);
      }
    },
    partyPolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('partyPolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set', 'remove']);
      }
    },
    feePolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('feePolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set', 'remove']);
      }
    },
    changePolicy: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object']);
        // Accept either simple format {pk, sk} or resolved format {primaryKey, ...fields}
        if (value.pk && value.sk) {
          // Simple primaryKey format
          rf.expectPrimaryKey(value);
        } else if (value.primaryKey) {
          // Fully resolved format with primaryKey property
          rf.expectPrimaryKey(value.primaryKey);
        } else {
          throw new Error('changePolicy must include either pk/sk or primaryKey');
        }
        rf.expectAction(action, ['set', 'remove']);
      }
    },
    passesRequired: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
    qrCodeEnabled: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['boolean']);
        rf.expectAction(action, ['set']);
      }
    },
  }
};

const PRODUCT_DEFAULT_PROPERTY_NAMES = [
  'searchTerms',
  'displayName',
  'description',
  'imageUrl',
]

const PRODUCT_DAILY_PROPERTIES_CONFIG = {
  allowOverwrite: true,
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
}

const PRODUCT_DEFAULT_SCHEDULE_RANGE = {
  weeks: 2,
}

module.exports = {
  ALLOWED_FILTERS,
  PRODUCT_API_PUT_CONFIG,
  PRODUCT_API_UPDATE_CONFIG,
  PRODUCT_DEFAULT_SCHEDULE_RANGE,
  PRODUCT_DAILY_PROPERTIES_CONFIG,
  PRODUCT_DEFAULT_PROPERTY_NAMES,
}
