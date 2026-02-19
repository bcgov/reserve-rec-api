const DEFAULT_API_UPDATE_CONFIG = {
    fields: {},
    failOnError: true,
    autoTimestamp: false,
    autoVersion: false,
};

// Available timezones for British Columbia.
const TIMEZONE_ENUMS = ['America/Vancouver', 'America/Edmonton', 'America/Fort_Nelson', 'America/Creston'];

// The following are the allowed facility types and related subtypes for facilities
const FACILITY_TYPE_ENUMS = {
    campground: [],
    structure: ['parkingLot', 'boatLaunch', 'yurt', 'building', 'cabin'],
    trail: [],
    accessPoint: [],
    naturalFeature: ['lake', 'summit', 'pointOfInterest', 'bay', 'river', 'beach'],
    dayUse: []
  };

// The following are the allowed filters for the activity collection API.
const ALLOWED_FILTERS = [
  { name: "isVisible", type: "boolean" },
  { name: "activityType", type: "list" },
  { name: "activityId", type: "number" },
  { name: "subActivityType", type: "list" },
  { name: "facilities", type: "list" }
];

// The following are the allowed sub-activity types for activities.
const SUB_ACTIVITY_TYPE_ENUMS = [
  'campsite',
  'walkin',
  'rv',
  'reservation',
  'passport',
  'vehicleParking',
  'trailUse',
  'shelterUse',
  'saniUse',
  'showerUse',
  'elecUse',
  'dockMooring',
  'buoyMooring',
  'frontcountry',
  'backcountry',
  'portionCircuit',
  'fullCircuit',
];

// The following are the allowed activity types for activities.
const ACTIVITY_TYPE_ENUMS = [
  'frontcountryCamp',
  'backcountryCamp',
  'groupCamp',
  'dayuse',
  'boating',
  'cabinStay',
  'canoe'
];

// The following are the allowed policy types.
const POLICY_TYPE_ENUMS = ['booking', 'change', 'fee', 'party'];

const PARTY_AGE_CATEGORY_ENUMS = [
  'adult',
  'child',
  'senior',
  'youth'
];

const PARTY_UNIT_TYPE_ENUMS = [
  'person',
  'vehicle',
  'site',
  'cabin',
  'tentpad',
  'bunk',
  'shelter'
]

const RATE_CLASS_ENUMS = [
    'standard',
    'senior',
    'SSCFE'
];

const BOOKING_STATUS_ENUMS = [
    'in progress',
    'confirmed',
    'cancelled',
    'expired'
]

const TRANSACTION_STATUS_ENUMS = [
  'in progress',
  'paid',
  'refund in progress',
  'refunded',
  'partial refund',
  'failed',
  'void',
  'unknown'
];

const INVENTORY_STATUS_ENUMS = [
  'available',
  'held',
  'reserved',
  'releasing'
];

const DURATION_PROPERTY_ENUMS = [
  'years',
  'months',
  'weeks',
  'days',
  'hours',
  'minutes',
  'seconds'
];

const TIME_24H_ENUMS = [
  'hour',
  'minute',
  'second'
];

const POLICY_BOOKING_RESERVATION_WINDOW_TYPE_ENUMS = [
  'rolling',
  'fixed',
];

// TEMPORARY: Default pricing values (easy to remove later)
// TODO: Remove these defaults and throw error when activities have pricing configured
const DEFAULT_PRICE = 999.99;
const DEFAULT_TRANSACTION_FEE_PERCENT = 3.0;
const DEFAULT_TAX_PERCENT = 5.0;

// Booking validation defaults (may be overridden per activity type)
const DEFAULT_MAX_BOOKING_DAYS_AHEAD = 2;
const DEFAULT_MAX_OCCUPANTS = 4;
const DEFAULT_MAX_VEHICLES = 1;

module.exports = {
  DEFAULT_API_UPDATE_CONFIG,
  DURATION_PROPERTY_ENUMS,
  TIME_24H_ENUMS,
  TRANSACTION_STATUS_ENUMS,
  INVENTORY_STATUS_ENUMS,
  ALLOWED_FILTERS,
  BOOKING_STATUS_ENUMS,
  SUB_ACTIVITY_TYPE_ENUMS,
  ACTIVITY_TYPE_ENUMS,
  FACILITY_TYPE_ENUMS,
  PARTY_AGE_CATEGORY_ENUMS,
  PARTY_UNIT_TYPE_ENUMS,
  POLICY_TYPE_ENUMS,
  RATE_CLASS_ENUMS,
  TIMEZONE_ENUMS,
  POLICY_BOOKING_RESERVATION_WINDOW_TYPE_ENUMS,
  DEFAULT_PRICE,
  DEFAULT_TRANSACTION_FEE_PERCENT,
  DEFAULT_TAX_PERCENT,
  DEFAULT_MAX_BOOKING_DAYS_AHEAD,
  DEFAULT_MAX_OCCUPANTS,
  DEFAULT_MAX_VEHICLES
};
