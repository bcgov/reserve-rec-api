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
ALLOWED_FILTERS = [
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

const RATE_CLASS_ENUMS = [
    'standard',
    'senior',
    'SSCFE'
];

const BOOKING_STATUS_ENUMS = [
    'confirmed',
    'cancelled',
    'expired'
]

module.exports = {
    DEFAULT_API_UPDATE_CONFIG,
    ALLOWED_FILTERS,
    BOOKING_STATUS_ENUMS,
    SUB_ACTIVITY_TYPE_ENUMS,
    ACTIVITY_TYPE_ENUMS,
    FACILITY_TYPE_ENUMS,
    PARTY_AGE_CATEGORY_ENUMS,
    POLICY_TYPE_ENUMS,
    RATE_CLASS_ENUMS,
    TIMEZONE_ENUMS,
};
