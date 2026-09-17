/**
 * DynamoDB Collection Seeding Script
 *
 * Seeds a full collection hierarchy directly to DynamoDB using AWS SDK v2 DocumentClient.
 * Writes: geozone, facilities, activities, products, productDates, inventoryPools,
 *         counters, and relationships.
 *
 * Usage:
 *   TABLE_NAME=ReserveRecApi-Local-ReferenceDataTable \
 *   DYNAMODB_ENDPOINT_URL=http://localhost:8000 \
 *   node seed-collection.js
 *
 * To target a different environment, set TABLE_NAME and DYNAMODB_ENDPOINT_URL accordingly.
 * To seed only some of the collections below, set COLLECTION_IDS=bcparks_15,bcparks_7.
 * To seed a collection that is not here yet, add an entry to SEED_CONFIG.
 */

const AWS = require('aws-sdk');
const { randomUUID } = require('crypto');
const { updateConsoleProgress, finishConsoleUpdates, errorConsoleUpdates } = require('./progressIndicator');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURATION — edit this section for each collection
// ─────────────────────────────────────────────────────────────────────────────

const SEED_CONFIG = [
  {
    collectionId: "bcparks_7",
    geozone: {
      id: 1,
      displayName: "Garibaldi Park",
      description:
        "Located in the heart of the Coast Mountains just 64 km north of Vancouver, Garibaldi is known for its natural beauty and numerous hiking trails. Here, you'll find rich geological history, diverse vegetation, snow-capped mountains, iridescent waters, abundant wildlife, and scenic vistas. The towering 2,678 m peak of Mount Garibaldi is the park's centrepiece. Offering over 90 km of established hiking trails, Garibaldi Park is a favourite year-round destination for outdoor enthusiasts.",
      location: { lat: 49.91664050774251, lng: -122.7499730960481 },
      envelope: {
        ne: { lat: 49.91664050774251, lng: -122.7499730960481 },
        sw: { lat: 49.91, lng: -122.77 },
      },
      timezone: "America/Vancouver",
      isVisible: true,
      minMapZoom: 8,
      maxMapZoom: 18,
      imageUrl:
        "https://nrs.objectstore.gov.bc.ca/kuwyyf/garibaldi_park_7_gal_RS_494_0de67eb6e8.jpg",
      parkLink: "https://bcparks.ca/garibaldi-park/",
      searchTerms: [],

      // Each facility has a type, id, displayName, and a list of activities.
      // Each activity has a type, id, displayName, and a list of products.
      // Each product has a date range and capacity, and uses asset::pass::1.
      facilities: [
        {
          type: "structure",
          facilitySubType: 'parkingLot',
          id: 1,
          displayName: "Cheakamus",
          location: { lat: 49.830179789157384, lng: -123.1345454334382 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 1,
              displayName: "Cheakamus day-use vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Day-use vehicle pass - AM",
                  startDate: "2026-09-24",
                  endDate: "2026-10-12",
                  capacity: 49,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
                {
                  id: 2,
                  displayName: "Day-use vehicle pass - PM",
                  startDate: "2026-09-24",
                  endDate: "2026-10-12",
                  capacity: 39,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
              ],
            },
          ],
        },
        {
          type: "structure",
          facilitySubType: 'parkingLot',
          id: 2,
          displayName: "Diamond Head",
          location: { lat: 49.750114441219765, lng: -123.05351987112826 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 2,
              displayName: "Diamond Head day-use vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Day-use vehicle pass - DAY",
                  startDate: "2026-09-24",
                  endDate: "2026-10-12",
                  capacity: 55,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
              ],
            },
          ],
        },
        {
          type: "structure",
          facilitySubType: 'parkingLot',
          id: 3,
          displayName: "Rubble Creek",
          location: { lat: 49.95726293586057, lng: -123.12024110842904 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 3,
              displayName: "Rubble Creek day-use vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Day-use vehicle pass - DAY",
                  startDate: "2026-09-24",
                  endDate: "2026-10-12",
                  capacity: 230,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    collectionId: "bcparks_8",
    geozone: {
      id: 1,
      displayName: "Golden Ears Park",
      description:
        "Golden Ears Park is one of B.C.'s largest parks and one of the province's most popular camping destinations. With recreation opportunities just over an hour east of Vancouver, the park draws visitors from across the Lower Mainland, and beyond. The park offers these visitors three large campgrounds and an extensive system of hiking and horseback-riding trails. Alouette Lake, meanwhile, is a popular spot for swimming, windsurfing, water-skiing, canoeing, boating, and fishing. The landscape of Golden Ears Park offers an excellent example of B.C.'s coastal western hemlock forest. The park's extensive backcountry is mountainous and extremely rugged.",
      location: { lat: 49.24292697449639, lng: -122.54490406794827 },
      envelope: {
        ne: { lat: 49.24292697449639, lng:  -122.54490406794827 },
        sw: { lat: 49.44, lng: -122.55 },
      },
      timezone: "America/Vancouver",
      isVisible: true,
      minMapZoom: 8,
      maxMapZoom: 18,
      imageUrl:
        "https://nrs.objectstore.gov.bc.ca/kuwyyf/RS_7390_Golden_Ears_gal_e622f8f345.jpg",
      parkLink: "https://bcparks.ca/golden-ears-park/",
      searchTerms: [],

      // Each facility has a type, id, displayName, and a list of activities.
      // Each activity has a type, id, displayName, and a list of products.
      // Each product has a date range and capacity, and uses asset::pass::1.
      facilities: [
        {
          type: "structure",
          facilitySubType: "parkingLot",
          id: 1,
          displayName: "Alouette Lake boat launch parking",
          location: { lat: 49.29490177711635, lng: -122.48987581278914 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 1,
              displayName: "Alouette Lake boat launch vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Alouette Lake boat launch vehicle pass - DAY",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  holidays: [],
                  timezone: "America/Vancouver",
                },
              ],
            },
          ],
        },
        {
          type: "structure",
          facilitySubType: "parkingLot",
          id: 2,
          displayName: "Alouette Lake South Beach day-use parking lot",
          location: { lat: 49.289547624248954, lng: -122.49159591340046 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 2,
              displayName: "Alouette Lake South Beach day-use vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Alouette Lake South Beach day-use vehicle pass - AM",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                },
                {
                  id: 2,
                  displayName: "Alouette Lake South Beach day-use vehicle pass - PM",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                },
              ],
            },
          ],
        },
        {
          type: "structure",
          facilitySubType: "parkingLot",
          id: 3,
          displayName: "Gold Creek Parking Lot",
          location: { lat: 49.33362452779655, lng: -122.45742977488821 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 3,
              displayName: "Gold Creek parking lot pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Gold Creek day-use vehicle pass - AM",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                },
                {
                  id: 2,
                  displayName: "Gold Creek day-use vehicle pass - PM",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                },
              ],
            },
          ],
        },
        {
          type: "structure",
          facilitySubType: "parkingLot",
          id: 4,
          displayName: "West Canyon Trailhead parking lot",
          location: { lat: 49.32729884624837, lng: -122.46291223293959 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 4,
              displayName: "West Canyon Trailhead day-use vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "West Canyon Trailhead day-use vehicle pass - AM",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                },
                {
                  id: 2,
                  displayName: "West Canyon Trailhead day-use vehicle pass - PM",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                  startDate: "2026-09-06",
                  endDate: "2026-09-07",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday'],
                  timezone: "America/Vancouver",
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    collectionId: "bcparks_15",
    geozone: {
      id: 1,
      displayName: "Mount Seymour Park",
      description:
        "Located just 30 minutes from downtown Vancouver, Mount Seymour Park has been enjoyed by generations of Lower Mainland residents. The park offers viewpoints overlooking the city of Vancouver, Mount Baker, and east over Indian Arm Park. There are opportunities for bird and wildlife viewing, and four areas for day-use picnicking are available. There are several lakes in the park. Elsay Lake is the largest. Its waters and those of De Pencier, Gopher, and Goldie drain eastward to Indian Arm. Some of the smaller lakes and ponds feed their waters west to the Seymour River. You will find many trails of various lengths and difficulty. Lower mountain trails are used extensively by mountain bikers and hikers, while upper mountain trails are for hiking only. Winter trails are put in place each year. The park offers extensive winter recreation facilities including skiing, snowshoeing, and a supervised snow-play area operated by Mt Seymour Resort. There are impressive views of the Lower Mainland, the Fraser Valley, and Mount Baker from the Deep Cove lookout parking lot and from the parking lots and pull-outs near the top of the mountain.",
      location: { lat: 49.35916756378567, lng: -122.94842876614055 },
      envelope: {
        ne: { lat: 49.35916756378567, lng: -122.94842876614055 },
        sw: { lat: 49.33, lng: -122.99 },
      },
      timezone: "America/Vancouver",
      isVisible: true,
      minMapZoom: 8,
      maxMapZoom: 18,
      imageUrl:
        "https://nrs.objectstore.gov.bc.ca/kuwyyf/RS_3965_Mount_Seymour_Iain_Robert_Reid_43_gal_418b88d2e7.jpg",
      parkLink: "https://bcparks.ca/mount-seymour-park/",
      searchTerms: [],

      // Each facility has a type, id, displayName, and a list of activities.
      // Each activity has a type, id, displayName, and a list of products.
      // Each product has a date range and capacity, and uses asset::pass::1.
      facilities: [
        {
          type: "structure",
          facilitySubType: 'parkingLot',
          id: 1,
          displayName: "Daily additional parking",
          location: { lat: 49.3678, lng: -122.9482 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 1,
              displayName: "Daily additional parking pass",
              activitySubType: "vehicleParking",
              products: [],
            },
          ],
        },
        {
          type: "structure",
          facilitySubType: 'parkingLot',
          id: 2,
          displayName: "P1 and Lower P5",
          location: { lat: 49.3678, lng: -122.9482 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 2,
              displayName: "P1 and Lower P5 day-use vehicle pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "P1 and Lower P5 day-use vehicle pass - AM",
                  startDate: "2026-03-28",
                  endDate: "2026-03-28",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
                {
                  id: 2,
                  displayName: "P1 and Lower P5 day-use vehicle pass - PM",
                  startDate: "2026-03-28",
                  endDate: "2026-03-28",
                  capacity: 0,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    collectionId: "bcparks_363",
    geozone: {
      id: 1,
      displayName: "Joffre Lakes Park",
      description:
        "Joffre Lakes Park is famous for its turquoise-blue lakes, jagged peaks, icefields, and cold rushing streams. The park offers stunning views and opportunities for hiking, camping, and climbing. This is an increasingly popular park, so backcountry camping reservations and day-use passes are often required.",
      location: { lat: 50.36636056711681, lng: -122.49656848350756 },
      envelope: {
        ne: { lat: 50.36636056711681, lng: -122.49656848350756 },
        sw: { lat: 50.32, lng: -122.53 },
      },
      timezone: "America/Vancouver",
      isVisible: true,
      minMapZoom: 8,
      maxMapZoom: 18,
      imageUrl:
        "https://nrs.objectstore.gov.bc.ca/kuwyyf/joffre_lakes_RS_1984_c362beed7c.jpg",
      parkLink: "https://bcparks.ca/joffre-lakes-park/",
      searchTerms: [],

      // Each facility has a type, id, displayName, and a list of activities.
      // Each activity has a type, id, displayName, and a list of products.
      // Each product has a date range and capacity, and uses asset::pass::1.
      facilities: [
        {
          type: "trail",
          id: 1,
          displayName: "Joffre Lakes",
          location: { lat: 50.36983554707154, lng: -122.49998969223124 },
          timezone: "America/Vancouver",
          minMapZoom: 8,
          maxMapZoom: 18,
          isVisible: true,
          isOpen: true,
          passesRequired: true,
          activities: [
            {
              type: "dayuse",
              id: 1,
              displayName: "Joffre Lakes day-use trail pass",
              activitySubType: "trailUse",
              products: [
                {
                  id: 1,
                  displayName: "Joffre Lakes day-use trail pass - DAY",
                  startDate: "2026-10-01",
                  endDate: "2026-10-25",
                  capacity: 570,
                  weekdays: ['Friday', 'Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday'],
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
              ],
            },
          ],
        },
      ],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// AWS / DynamoDB setup
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NAME = process.env.TABLE_NAME || 'ReserveRecApi-Local-ReferenceDataStack-ReferenceDataTable';
const MAX_BATCH_SIZE = 25;

const options = {
  region: process.env.AWS_REGION || 'local',
  endpoint: process.env.DYNAMODB_ENDPOINT_URL || 'http://localhost:8000/'
};

console.log('Using DynamoDB config:', options);
console.log('Table:', TABLE_NAME);

const dynamodb = new AWS.DynamoDB.DocumentClient(options);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function now() {
  return new Date().toISOString();
}

// Holidays for remaining days of 2026
const HOLIDAYS = [
  '2026-09-30',
  '2026-10-12',
  '2026-11-11',
  '2026-12-25',
];

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/**
 * Generates selected dates between startDate and endDate (inclusive).
 * weekdays accepts names (for example, ['Friday', 'Saturday']) or UTC day
 * numbers (0 = Sunday through 6 = Saturday).
 */
function buildDateRange(startDate, endDate, weekdays = WEEKDAYS, holidays = HOLIDAYS) {
  const weekdayNumbers = weekdays === null
    ? null
    : new Set((Array.isArray(weekdays) ? weekdays : [weekdays]).map(day => {
      if (typeof day === 'number' && day >= 0 && day <= 6) return day;

      const dayName = String(day).trim().toLowerCase();
      const dayNumber = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      }[dayName];

      if (dayNumber === undefined) {
        throw new Error(`Invalid weekday: ${day}`);
      }
      return dayNumber;
    }));
  const holidayDates = new Set(holidays);
  const dates = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    const date = current.toISOString().slice(0, 10);
    if (weekdayNumbers === null || weekdayNumbers.has(current.getUTCDay()) || holidayDates.has(date)) {
      dates.push(date);
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

// ─────────────────────────────────────────────────────────────────────────────
// Default policies
// These match the standard day-use policies from bcparks_7 and are embedded
// directly into product and productDate items as the API would normally do.
// ─────────────────────────────────────────────────────────────────────────────

const POLICY_CHANGE = {
  pk: 'policy::change::1',
  sk: 'v1',
  createdAt: '2026-02-25T10:00:00Z',
  description: 'This is the standard change policy for day-use products in summer 2026. No changes or cancellations are allowed under this policy.',
  displayName: 'Standard Day Use Change Policy #1 (Summer 2026)',
  globalId: '550e8400-e29b-41d4-a716-446655440000',
  gsipk: 'policy::change',
  gsisk: 'true',
  isLatest: true,
  lastUpdated: '2026-02-25T10:00:00Z',
  policyId: '1',
  policyIdVersion: 1,
  policyType: 'change',
  productDateRules: { isCancellationAllowed: false, isChangeAllowed: false },
  productRules: { isCancellationAllowed: false, isChangeAllowed: false },
  schema: 'policy',
};

const POLICY_FEE = {
  pk: 'policy::fee::1',
  sk: 'v1',
  createdAt: '2026-02-25T10:00:00Z',
  description: 'This is the standard fee policy for day-use offerings. There is no fee associated with this policy.',
  displayName: 'Standard Day Use Fee Policy',
  globalId: 'd9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f',
  gsipk: 'policy::fee',
  gsisk: 'true',
  isLatest: false,
  lastUpdated: '2026-02-25T10:00:00Z',
  policyId: '1',
  policyIdVersion: 1,
  policyType: 'fee',
  productDateRules: { feeSchedule: [], lineItems: [] },
  productRules: {
    feeSchedule: [],
    lineItems: [
      {
        discountsApplied: [],
        id: 'noCharge',
        if: [],
        isReturnable: false,
        label: 'Free',
        quantity: { type: 'constant', value: 1 },
        rate: { type: 'constant', value: 0 },
        taxApplied: [],
        type: 'free',
      },
    ],
  },
  schema: 'policy',
};

const POLICY_PARTY__VEHICLE = {
  "pk": "policy::party::1",
  "sk": "v1",
  "createdAt": "2026-02-25T10:00:00Z",
  "description": "This is the standard party policy for day-use vehicle offerings in summer 2026.",
  "displayName": "Standard day-use vehicle party policy #1 (Summer 2026)",
  "globalId": "d9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f",
  "gsipk": "policy::party",
  "gsisk": "true",
  "isLatest": true,
  "lastUpdated": "2026-02-25T10:00:00Z",
  "policyId": "1",
  "policyIdVersion": 1,
  "policyType": "party",
  "productRules": {
  "partyCategories": [
    {
    "id": "passes",
    "label": "Number of Passes",
    "maxCount": 1,
    "minCount": 1
    }
  ],
  "partyCompositionRules": [
  ]
  },
  "schema": "policy"
}

const POLICY_PARTY__TRAIL = {
  "pk": "policy::party::2",
  "sk": "v1",
  "createdAt": "2026-02-25T10:00:00Z",
  "description": "This is the standard party policy for day-use trail offerings in summer 2026.",
  "displayName": "Standard day-use trail party policy #1 (Summer 2026)",
  "globalId": "d9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f",
  "gsipk": "policy::party",
  "gsisk": "true",
  "isLatest": true,
  "lastUpdated": "2026-02-25T10:00:00Z",
  "policyId": "2",
  "policyIdVersion": 1,
  "policyType": "party",
  "productRules": {
  "partyCategories": [
    {
    "id": "passes",
    "label": "Number of Passes",
    "maxCount": 4,
    "minCount": 1
    }
  ],
  "partyCompositionRules": [
  ]
  },
  "schema": "policy"
}

// productDateRules
const RESERVATION_POLICY_DATE_RULES__ALL_DAY = {
  "pk": "policy::reservation::1",
  "sk": "v1",
  "createdAt": "2026-02-25T10:00:00Z",
  "description": "",
  "displayName": "Standard day-use all day reservation policy #1 (Summer 2026)",
  "globalId": "d9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f",
  "gsipk": "policy::reservation",
  "gsisk": "true",
  "isLatest": true,
  "lastUpdated": "2026-02-25T10:00:00Z",
  "policyId": "1",
  "policyIdVersion": 1,
  "policyType": "reservation",
  "productDateRules": {
  "isDiscoverable": true,
  "isReservable": true,
  "maxDailyInventory": 1,
  "minDailyInventory": 1,
  "temporalAnchors": [
    {
    "fixedDateTime": "2026-01-01",
    "id": "discoveryWindowOpen",
    "label": "Discovery Window Open",
    "timeOfDay": {
      "hour": 7
    }
    },
    {
    "fixedDateTime": "2026-12-31T23:59:59-08:00",
    "id": "discoveryWindowClose",
    "label": "Discovery Window Close",
    "timeOfDay": {
      "hour": 17
    }
    },
    {
    "anchorRef": "productDate",
    "id": "checkInTime",
    "label": "Check-In Time",
    "timeOfDay": {
      "hour": 7
    }
    },
    {
    "anchorRef": "productDate",
    "id": "checkOutTime",
    "label": "Check-Out Time",
    "timeOfDay": {
      "hour": 17
    }
    },
    {
      id: 'reservationWindow', label: 'Reservation Window',
      open: { anchorRef: 'productDate', duration: { direction: 'before', days: 2 }, timeOfDay: { hour: 7 } },
      close: { anchorRef: 'productDate', timeOfDay: { hour: 17 } },
    },
    "id": "noShowTime",
    "label": "No-Show Time",
    "timeOfDay": {
      "hour": 17
    }
    }
  ],
  "temporalWindows": [
    {
    "close": {
      "anchorRef": "discoveryWindowClose",
      "keepInputTime": true
    },
    "id": "discoveryWindow",
    "label": "Discovery Window",
    "open": {
      "anchorRef": "discoveryWindowOpen",
      "keepInputTime": true
    }
    },
    {
    "close": {
      "anchorRef": "productDate",
      "timeOfDay": {
      "hour": 17
      }
    },
    "id": "reservationWindow",
    "label": "Reservation Window",
    "open": {
      "anchorRef": "productDate",
      "duration": {
      "direction": "before",
      "days": 2
      },
      "timeOfDay": {
      "hour": 7
      }
    }
    }
  ]
  },
  "productRules": {
  "availabilityEstimationPattern": {
    "cadence": {
    "id": "5min",
    "label": "Every 5 minutes"
    },
    "estimationMode": "tiered",
    "tiers": [
    {
      "id": "full",
      "label": "Full",
      "maxPercentage": 0
    },
    {
      "id": "low",
      "label": "Low",
      "maxPercentage": 0.25
    },
    {
      "id": "medium",
      "label": "Medium",
      "maxPercentage": 0.75
    },
    {
      "id": "high",
      "label": "High",
      "maxPercentage": 1
    }
    ]
  },
  "holdDuration": {
    "minutes": 15
  },
  "isDiscoverable": true,
  "isReservable": true,
  "maxTotalDays": 1,
  "minTotalDays": 1,
  "temporalWindows": [
    {
    "close": {
      "anchorRef": "discoveryWindowEnd"
    },
    "id": "discoveryWindow",
    "label": "Discovery Window",
    "open": {
      "anchorRef": "discoveryWindowStart"
    }
    }
  ]
  },
  "reservationContext": {
  "discoveryWindowEnd": "2026-12-31T23:59:59-08:00",
  "discoveryWindowStart": "2026-01-01T07:00:00-08:00"
  },
  "schema": "policy"
}

const RESERVATION_POLICY_DATE_RULES__AM = {
  "pk": "policy::reservation::2",
  "sk": "v1",
  "createdAt": "2026-02-25T10:00:00Z",
  "description": "",
  "displayName": "Standard day-use AM reservation policy #1 (Summer 2026)",
  "globalId": "d9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f",
  "gsipk": "policy::reservation",
  "gsisk": "true",
  "isLatest": true,
  "lastUpdated": "2026-02-25T10:00:00Z",
  "policyId": "2",
  "policyIdVersion": 1,
  "policyType": "reservation",
  "productDateRules": {
  "isDiscoverable": true,
  "isReservable": true,
  "maxDailyInventory": 1,
  "minDailyInventory": 1,
  "temporalAnchors": [
    {
    "fixedDateTime": "2026-01-01",
    "id": "discoveryWindowOpen",
    "label": "Discovery Window Open",
    "timeOfDay": {
      "hour": 7
    }
    },
    {
    "fixedDateTime": "2026-12-31T23:59:59-08:00",
    "id": "discoveryWindowClose",
    "label": "Discovery Window Close",
    "timeOfDay": {
      "hour": 13
    }
    },
    {
    "anchorRef": "productDate",
    "id": "checkInTime",
    "label": "Check-In Time",
    "timeOfDay": {
      "hour": 7
    }
    },
    {
    "anchorRef": "productDate",
    "id": "checkOutTime",
    "label": "Check-Out Time",
    "timeOfDay": {
      "hour": 13
    }
    },
    {
    "anchorRef": "productDate",
    "duration": {
      "days": 1,
      "direction": "after"
    },
    "id": "noShowTime",
    "label": "No-Show Time",
    "timeOfDay": {
      "hour": 13
    }
    }
  ],
  "temporalWindows": [
    {
    "close": {
      "anchorRef": "discoveryWindowClose",
      "keepInputTime": true
    },
    "id": "discoveryWindow",
    "label": "Discovery Window",
    "open": {
      "anchorRef": "discoveryWindowOpen",
      "keepInputTime": true
    }
    },
    {
    "close": {
      "anchorRef": "productDate",
      "timeOfDay": {
      "hour": 13
      }
    },
    "id": "reservationWindow",
    "label": "Reservation Window",
    "open": {
      "anchorRef": "productDate",
      "duration": {
      "direction": "before",
      "days": 2
      },
      "timeOfDay": {
      "hour": 7
      }
    }
    }
  ]
  },
  "productRules": {
  "availabilityEstimationPattern": {
    "cadence": {
    "id": "5min",
    "label": "Every 5 minutes"
    },
    "estimationMode": "tiered",
    "tiers": [
    {
      "id": "full",
      "label": "Full",
      "maxPercentage": 0
    },
    {
      "id": "low",
      "label": "Low",
      "maxPercentage": 0.25
    },
    {
      "id": "medium",
      "label": "Medium",
      "maxPercentage": 0.75
    },
    {
      "id": "high",
      "label": "High",
      "maxPercentage": 1
    }
    ]
  },
  "holdDuration": {
    "minutes": 15
  },
  "isDiscoverable": true,
  "isReservable": true,
  "maxTotalDays": 1,
  "minTotalDays": 1,
  "temporalWindows": [
    {
    "close": {
      "anchorRef": "discoveryWindowEnd"
    },
    "id": "discoveryWindow",
    "label": "Discovery Window",
    "open": {
      "anchorRef": "discoveryWindowStart"
    }
    }
  ]
  },
  "reservationContext": {
  "discoveryWindowEnd": "2026-12-31T23:59:59-08:00",
  "discoveryWindowStart": "2026-01-01T07:00:00-08:00"
  },
  "schema": "policy"
}

const RESERVATION_POLICY_DATE_RULES__PM = {
  "pk": "policy::reservation::3",
  "sk": "v1",
  "createdAt": "2026-02-25T10:00:00Z",
  "description": "",
  "displayName": "Standard day-use PM reservation policy #1 (Summer 2026)",
  "globalId": "d9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f",
  "gsipk": "policy::reservation",
  "gsisk": "true",
  "isLatest": true,
  "lastUpdated": "2026-02-25T10:00:00Z",
  "policyId": "3",
  "policyIdVersion": 1,
  "policyType": "reservation",
  "productDateRules": {
  "isDiscoverable": true,
  "isReservable": true,
  "maxDailyInventory": 1,
  "minDailyInventory": 1,
  "temporalAnchors": [
    {
    "fixedDateTime": "2026-01-01",
    "id": "discoveryWindowOpen",
    "label": "Discovery Window Open",
    "timeOfDay": {
      "hour": 7
    }
    },
    {
    "fixedDateTime": "2026-12-31T23:59:59-08:00",
    "id": "discoveryWindowClose",
    "label": "Discovery Window Close",
    "timeOfDay": {
      "hour": 17
    }
    },
    {
    "anchorRef": "productDate",
    "id": "checkInTime",
    "label": "Check-In Time",
    "timeOfDay": {
      "hour": 13
    }
    },
    {
    "anchorRef": "productDate",
    "id": "checkOutTime",
    "label": "Check-Out Time",
    "timeOfDay": {
      "hour": 17
    }
    },
    {
    "anchorRef": "productDate",
    "duration": {
      "days": 1,
      "direction": "after"
    },
    "id": "noShowTime",
    "label": "No-Show Time",
    "timeOfDay": {
      "hour": 17
    }
    }
  ],
  "temporalWindows": [
    {
    "close": {
      "anchorRef": "discoveryWindowClose",
      "keepInputTime": true
    },
    "id": "discoveryWindow",
    "label": "Discovery Window",
    "open": {
      "anchorRef": "discoveryWindowOpen",
      "keepInputTime": true
    }
    },
    {
    "close": {
      "anchorRef": "productDate",
      "timeOfDay": {
      "hour": 17
      }
    },
    "id": "reservationWindow",
    "label": "Reservation Window",
    "open": {
      "anchorRef": "productDate",
      "duration": {
      "direction": "before",
      "days": 2
      },
      "timeOfDay": {
      "hour": 7
      }
    }
    }
  ]
  },
  "productRules": {
  "availabilityEstimationPattern": {
    "cadence": {
    "id": "5min",
    "label": "Every 5 minutes"
    },
    "estimationMode": "tiered",
    "tiers": [
    {
      "id": "full",
      "label": "Full",
      "maxPercentage": 0
    },
    {
      "id": "low",
      "label": "Low",
      "maxPercentage": 0.25
    },
    {
      "id": "medium",
      "label": "Medium",
      "maxPercentage": 0.75
    },
    {
      "id": "high",
      "label": "High",
      "maxPercentage": 1
    }
    ]
  },
  "holdDuration": {
    "minutes": 15
  },
  "isDiscoverable": true,
  "isReservable": true,
  "maxTotalDays": 1,
  "minTotalDays": 1,
  "temporalWindows": [
    {
    "close": {
      "anchorRef": "discoveryWindowEnd"
    },
    "id": "discoveryWindow",
    "label": "Discovery Window",
    "open": {
      "anchorRef": "discoveryWindowStart"
    }
    }
  ]
  },
  "reservationContext": {
  "discoveryWindowEnd": "2026-12-31T23:59:59-08:00",
  "discoveryWindowStart": "2026-01-01T07:00:00-08:00"
  },
  "schema": "policy"
}

// ─────────────────────────────────────────────────────────────────────────────
// Reservation context computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Converts a local date + hour in the given timezone to a UTC epoch millisecond value.
 * Uses the Intl offset trick: probe a UTC time, see what local clock shows, compute the diff.
 */
function localToEpochMs(dateStr, hour, timezone) {
  const localStr = `${dateStr}T${String(hour).padStart(2, '0')}:00:00`;
  const probe = new Date(localStr + 'Z');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(probe).reduce((acc, { type, value }) => ({ ...acc, [type]: value }), {});
  const shownHour = parts.hour === '24' ? 0 : parseInt(parts.hour, 10);
  const localShown = new Date(`${parts.year}-${parts.month}-${parts.day}T${String(shownHour).padStart(2, '0')}:${parts.minute}:00Z`).getTime();
  const offsetMs = probe.getTime() - localShown;
  return probe.getTime() + offsetMs;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Computes the reservationContext for a productDate given its reservation policy.
 * All temporal values are epoch milliseconds.
 */
function computeReservationContext(date, timezone, passType = 'ALL_DAY', activitySubType = 'VEHICLE') {
  const passTimes = {
    ALL_DAY: { checkInHour: 7, checkOutHour: 17 },
    AM: { checkInHour: 7, checkOutHour: 13 },
    PM: { checkInHour: 13, checkOutHour: 17 },
  };
  const { checkInHour, checkOutHour } = passTimes[passType] || passTimes.ALL_DAY;

  const checkInMs       = localToEpochMs(date, checkInHour, timezone);
  const checkOutMs      = localToEpochMs(date, checkOutHour, timezone);
  const noShowMs        = localToEpochMs(addDays(date, 1), checkOutHour, timezone);

  const discoveryWindowOpenMs  = localToEpochMs('2026-04-15', checkInHour, timezone);
  const discoveryWindowCloseMs = localToEpochMs('2026-12-31', checkOutHour, timezone);

  // Discovery window: date ± weeks at midnight in local timezone (keepInputTime = true)
  const discoveryOpenMs   = localToEpochMs(addDays(date, -21), 0, timezone);
  const discoveryCloseMs  = localToEpochMs(addDays(date,   7), 0, timezone);

  // Reservation window: passes release 2 days before the visit at 7am local (bcgov/reserve-rec-public#836)
  const reservationOpenMs = localToEpochMs(addDays(date, -2), 7, timezone);

  return {
    isDiscoverable: true,
    isReservable: true,
    maxDailyInventory: activitySubType == 'TRAIL' ? 4 : 1,
    minDailyInventory: 1,
    temporalAnchors: {
      checkInTime:          checkInMs,
      checkOutTime:         checkOutMs,
      discoveryWindowClose: discoveryWindowCloseMs,
      discoveryWindowOpen:  discoveryWindowOpenMs,
      noShowTime:           noShowMs,
    },
    temporalWindows: {
      discoveryWindow: {
        close: discoveryCloseMs,
        id: 'discoveryWindow',
        label: 'Discovery Window',
        open: discoveryOpenMs,
      },
      reservationWindow: {
        close: checkOutMs,
        id: 'reservationWindow',
        label: 'Reservation Window',
        open: reservationOpenMs,
      },
    },
  };
}

function resolveSubActivityPassType(activity, product) {
  let activitySubType = "VEHICLE";
  if (activity.activitySubType == "vehicleParking") {
    activitySubType = "VEHICLE"
  }
  if (activity.activitySubType == "trailUse") {
    activitySubType = "TRAIL"
  }
  
  let passType = 'AM';
  if (product.displayName.includes("- AM")) {
    passType = "AM"
  }
  if (product.displayName.includes("- PM")) {
    passType = "PM"
  }
  if (product.displayName.includes("- DAY")) {
    passType = "ALL_DAY"
  }

  return { activitySubType, passType }
}

// ─────────────────────────────────────────────────────────────────────────────
// Item builders
// ─────────────────────────────────────────────────────────────────────────────

function buildCollectionItem(collectionId, geozone) {
  const ts = now();
  return {
    pk: 'collection',
    sk: collectionId,
    schema: 'collection',
    collectionId,
    displayName: geozone.displayName,
    description: geozone.description || null,
    adminNotes: '',
    isVisible: geozone.isVisible,
    searchTerms: geozone.searchTerms || [],
    version: 1,
    creationDate: ts,
    lastUpdated: ts,
  };
}

function buildGeozoneItems(collectionId, geozone) {
  const ts = now();

  // Convert {lat, lng} → GeoJSON-style {coordinates: [lng, lat], type: 'point'}
  const location = {
    coordinates: [geozone.location.lng, geozone.location.lat],
    type: 'point',
  };

  // Convert {ne, sw} → OpenSearch envelope {coordinates: [[nw_lng, nw_lat], [se_lng, se_lat]], type: 'envelope'}
  // OpenSearch envelope = top-left (NW) → bottom-right (SE)
  const { ne, sw } = geozone.envelope;
  const envelope = {
    coordinates: [
      [Math.min(ne.lng, sw.lng), Math.max(ne.lat, sw.lat)], // NW / top-left
      [Math.max(ne.lng, sw.lng), Math.min(ne.lat, sw.lat)], // SE / bottom-right
    ],
    type: 'envelope',
  };

  const geozoneItem = {
    pk: `geozone::${collectionId}`,
    sk: String(geozone.id),
    schema: 'geozone',
    collectionId,
    geozoneId: geozone.id,
    identifier: geozone.id,
    displayName: geozone.displayName,
    description: geozone.description || null,
    adminNotes: '',
    location,
    envelope,
    timezone: geozone.timezone,
    isVisible: geozone.isVisible,
    minMapZoom: geozone.minMapZoom,
    maxMapZoom: geozone.maxMapZoom,
    imageUrl: geozone.imageUrl,
    parkLink: geozone.parkLink || null,
    searchTerms: geozone.searchTerms || [],
    version: 1,
    creationDate: ts,
    lastUpdated: ts,
  };

  const counterItem = {
    pk: `geozone::${collectionId}`,
    sk: 'counter',
    counterValue: geozone.id,
  };

  return [geozoneItem, counterItem];
}

function buildFacilityItems(collectionId, facilities) {
  const ts = now();
  const items = [];

  // Track max id per facilityType for counter
  const maxIds = {};

  for (const facility of facilities) {
    items.push({
      pk: `facility::${collectionId}`,
      sk: `${facility.type}::${facility.id}`,
      schema: 'facility',
      collectionId,
      facilityType: facility.type,
      facilitySubType: facility.facilitySubType,
      facilityId: facility.id,
      identifier: facility.id,
      displayName: facility.displayName,
      location: { coordinates: [facility.location.lng, facility.location.lat], type: 'point' },
      timezone: facility.timezone,
      minMapZoom: facility.minMapZoom,
      maxMapZoom: facility.maxMapZoom,
      isVisible: facility.isVisible,
      isOpen: facility.isOpen,
      passesRequired: facility.passesRequired,
      searchTerms: [],
      showOnMap: true,
      version: 1,
      creationDate: ts,
      lastUpdated: ts,
    });

    maxIds[facility.type] = Math.max(maxIds[facility.type] || 0, facility.id);
  }

  // One counter per facilityType
  for (const [type, maxId] of Object.entries(maxIds)) {
    items.push({
      pk: `facility::${collectionId}::${type}`,
      sk: 'counter',
      counterValue: maxId,
    });
  }

  return items;
}

function buildActivityItems(collectionId, facilities) {
  const ts = now();
  const items = [];
  const maxIds = {};

  for (const facility of facilities) {
    for (const activity of facility.activities) {
      items.push({
        pk: `activity::${collectionId}`,
        sk: `${activity.type}::${activity.id}`,
        schema: 'activity',
        collectionId,
        activityType: activity.type,
        activitySubType: activity.activitySubType || null,
        activityId: activity.id,
        identifier: activity.id,
        displayName: activity.displayName,
        version: 1,
        creationDate: ts,
        lastUpdated: ts,
        globalId: randomUUID(),
      });

      maxIds[activity.type] = Math.max(maxIds[activity.type] || 0, activity.id);
    }
  }

  for (const [type, maxId] of Object.entries(maxIds)) {
    items.push({
      pk: `activity::${collectionId}::${type}`,
      sk: 'counter',
      counterValue: maxId,
    });
  }

  return items;
}

function buildProductItems(collectionId, facilities) {
  const ts = now();
  const items = [];

  for (const facility of facilities) {
    for (const activity of facility.activities) {
      if (activity.products.length === 0) continue; // no products — skip counter too
      const maxId = Math.max(...activity.products.map(p => p.id));

      for (const product of activity.products) {
        // Returns either VEHICLE or TRAIL for activitySubType, and either AM, PM, or ALL_DAY for passType
        const { activitySubType, passType } = resolveSubActivityPassType(activity, product);

        const partyPolicy = {
          'VEHICLE': 'policy::party::1',
          'TRAIL': 'policy::party::2',
        }
        const reservationPolicy = {
          'ALL_DAY': 'policy::reservation::1',
          'AM': 'policy::reservation::2',
          'PM': 'policy::reservation::3'
        }

        items.push({
          pk: `product::${collectionId}::${activity.type}::${activity.id}`,
          sk: String(product.id),
          schema: 'product',
          collectionId,
          activityType: activity.type,
          activityId: activity.id,
          productId: product.id,
          identifier: product.id,
          displayName: product.displayName,
          rangeStart: product.startDate,
          rangeEnd: product.endDate,
          timezone: product.timezone,
          // Asset list drives inventoryPool creation — one pass asset
          assetList: [
            {
              primaryKey: { pk: 'asset::pass::1', sk: 'v1' },
              allocationType: 'fixed',
              quantity: product.capacity,
            }
          ],
          isVisible: product.isVisible,
          passesRequired: product.passesRequired,
          qrCodeEnabled: product.qrCodeEnabled,
          changePolicy:      { primaryKey: { pk: 'policy::change::1',      sk: 'v1' } },
          feePolicy:         { primaryKey: { pk: 'policy::fee::1',         sk: 'v1' } },
          partyPolicy:       { primaryKey: { pk: partyPolicy[activitySubType],       sk: 'v1' } },
          reservationPolicy: {
            isDiscoverable: true,
            isReservable: true,
            maxTotalDays: 14,
            minTotalDays: 1,
            primaryKey: { pk: reservationPolicy[passType], sk: 'v1' },
          },
          version: 1,
          creationDate: ts,
          lastUpdated: ts,
          globalId: randomUUID(),
        });
      }

      items.push({
        pk: `product::${collectionId}::${activity.type}::${activity.id}`,
        sk: 'counter',
        counterValue: maxId,
      });
    }
  }

  return items;
}

function buildProductDateItems(collectionId, facilities) {
  const ts = now();
  const items = [];

  for (const facility of facilities) {
    for (const activity of facility.activities) {
      for (const product of activity.products) {
        const dates = buildDateRange(
          product.startDate,
          product.endDate,
          product?.weekdays,
          product?.holidays,
        );
        for (const date of dates) {
          const { activitySubType, passType } = resolveSubActivityPassType(activity, product);

          items.push({
            pk: `productDate::${collectionId}::${activity.type}::${activity.id}::${product.id}`,
            sk: date,
            schema: 'productDate',
            collectionId,
            activityType: activity.type,
            activityId: activity.id,
            productId: product.id,
            date,
            displayName: `${product.displayName} - ${date}`,
            assetList: [
              {
                primaryKey: { pk: 'asset::pass::1', sk: 'v1' },
                allocationType: 'fixed',
                quantity: product.capacity,
              }
            ],
            changePolicy:      POLICY_CHANGE,
            feePolicy:         POLICY_FEE,
            partyPolicy:       `POLICY_PARTY__${activitySubType}`,
            reservationPolicy: `RESERVATION_POLICY_DATE_RULES__${passType}`,
            reservationContext: computeReservationContext(date, product.timezone, passType),
            availabilityEstimationPattern: null,
            version: 1,
            creationDate: ts,
            lastUpdated: ts,
            globalId: randomUUID(),
          });
        }
      }
    }
  }

  return items;
}

function buildInventoryPoolItems(collectionId, facilities) {
  const ts = now();
  const items = [];

  for (const facility of facilities) {
    for (const activity of facility.activities) {
      for (const product of activity.products) {
        const dates = buildDateRange(
          product.startDate,
          product.endDate,
          product?.weekdays,
          product?.holidays,
        );
        const productDatePk = `productDate::${collectionId}::${activity.type}::${activity.id}::${product.id}`;

        for (const date of dates) {
          const assetRef = {
            primaryKey: { pk: 'asset::pass::1', sk: 'v1' },
            allocationType: 'fixed',
            quantity: product.capacity,
          };

          items.push({
            pk: `inventoryPool::${collectionId}::${activity.type}::${activity.id}::${product.id}::${date}`,
            sk: 'asset::pass::1::v1',
            schema: 'inventoryPool',
            collectionId,
            date,
            assetRef,
            allocationType: 'fixed',
            productDateRef: {
              pk: productDatePk,
              sk: date,
            },
            productDateVersion: 1,
            capacity: product.capacity,
            availability: product.capacity,
            availabilityEstimationPattern: null,
            version: 1,
            creationDate: ts,
            lastUpdated: ts,
            globalId: randomUUID(),
          });
        }
      }
    }
  }

  return items;
}

/**
 * Builds a single relationship item.
 * The GSI (gsipk/gsisk) enables reverse lookups without a second record.
 */
function buildRelationshipItem(pk1, sk1, schema1, pk2, sk2, schema2) {
  const ts = now();
  return {
    pk: `rel::${pk1}::${sk1}`,
    sk: `${pk2}::${sk2}`,
    gsipk: `rel::${pk2}::${sk2}`,
    gsisk: `${pk1}::${sk1}`,
    schema: 'relationship',
    schema1,
    schema2,
    pk1,
    sk1,
    pk2,
    sk2,
    version: 1,
    creationDate: ts,
    lastUpdated: ts,
  };
}

function buildRelationshipItems(collectionId, geozone) {
  const items = [];
  const gPk = `geozone::${collectionId}`;
  const gSk = String(geozone.id);

  for (const facility of geozone.facilities) {
    const fPk = `facility::${collectionId}`;
    const fSk = `${facility.type}::${facility.id}`;

    // geozone -> facility
    items.push(buildRelationshipItem(gPk, gSk, 'geozone', fPk, fSk, 'facility'));

    for (const activity of facility.activities) {
      const aPk = `activity::${collectionId}`;
      const aSk = `${activity.type}::${activity.id}`;

      // geozone -> activity
      items.push(buildRelationshipItem(gPk, gSk, 'geozone', aPk, aSk, 'activity'));

      // facility -> activity
      items.push(buildRelationshipItem(fPk, fSk, 'facility', aPk, aSk, 'activity'));

      // activity -> product
      for (const product of activity.products) {
        const pPk = `product::${collectionId}::${activity.type}::${activity.id}`;
        items.push(buildRelationshipItem(aPk, aSk, 'activity', pPk, String(product.id), 'product'));
      }
    }
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch write
// ─────────────────────────────────────────────────────────────────────────────

async function batchWriteItems(items) {
  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const chunk = items.slice(i, i + MAX_BATCH_SIZE);
    const params = {
      RequestItems: {
        [TABLE_NAME]: chunk.map(item => ({ PutRequest: { Item: item } }))
      }
    };
    await dynamodb.batchWrite(params).promise();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  let configs = Array.isArray(SEED_CONFIG) ? SEED_CONFIG : [SEED_CONFIG];

  // COLLECTION_IDS=bcparks_15,bcparks_7 seeds just those collections. Seeding a
  // shared environment one collection at a time keeps a run from overwriting
  // records that belong to another park.
  const only = (process.env.COLLECTION_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  if (only.length) {
    configs = configs.filter(c => only.includes(c.collectionId));
    const missing = only.filter(id => !configs.some(c => c.collectionId === id));
    if (missing.length) {
      console.error(`No SEED_CONFIG entry for: ${missing.join(', ')}`);
      process.exit(1);
    }
  }
  const startTime = new Date().getTime();
  let totalWritten = 0;

  for (const { collectionId, geozone } of configs) {
    console.log(`\nSeeding collection: ${collectionId}`);

    try {
      // Build all items
      const collectionItem    = buildCollectionItem(collectionId, geozone);
      const geozoneItems      = buildGeozoneItems(collectionId, geozone);
      const facilityItems     = buildFacilityItems(collectionId, geozone.facilities);
      const activityItems     = buildActivityItems(collectionId, geozone.facilities);
      const productItems      = buildProductItems(collectionId, geozone.facilities);
      const productDateItems  = buildProductDateItems(collectionId, geozone.facilities);
      const inventoryItems    = buildInventoryPoolItems(collectionId, geozone.facilities);
      const relationshipItems = buildRelationshipItems(collectionId, geozone);

      const allItems = [
        collectionItem,
        ...geozoneItems,
        ...facilityItems,
        ...activityItems,
        ...productItems,
        ...productDateItems,
        ...inventoryItems,
        ...relationshipItems,
      ];

      console.log(`\n  Items to write:`);
      console.log(`    Collection:           1`);
      console.log(`    Geozone + counter:    ${geozoneItems.length}`);
      console.log(`    Facility + counters:  ${facilityItems.length}`);
      console.log(`    Activity + counters:  ${activityItems.length}`);
      console.log(`    Product + counters:   ${productItems.length}`);
      console.log(`    ProductDates:         ${productDateItems.length}`);
      console.log(`    InventoryPools:       ${inventoryItems.length}`);
      console.log(`    Relationships:        ${relationshipItems.length}`);
      console.log(`    ─────────────────────`);
      console.log(`    Total:                ${allItems.length}\n`);

      // Write in batches of 25
      for (let i = 0; i < allItems.length; i += MAX_BATCH_SIZE) {
        updateConsoleProgress(startTime, `Writing ${collectionId}`, 1, i + 1, allItems.length);
        const chunk = allItems.slice(i, i + MAX_BATCH_SIZE);
        const params = {
          RequestItems: {
            [TABLE_NAME]: chunk.map(item => ({ PutRequest: { Item: item } }))
          }
        };
        await dynamodb.batchWrite(params).promise();
      }

      updateConsoleProgress(startTime, `Writing ${collectionId}`, 1, allItems.length, allItems.length);
      totalWritten += allItems.length;
      console.log(`  ${allItems.length} items written for ${collectionId}.`);

    } catch (error) {
      errorConsoleUpdates(error);
      console.error(`\nSeed failed for ${collectionId}:`, error.message);
      process.exit(1);
    }
  }

  finishConsoleUpdates();
  console.log(`\nDone. ${totalWritten} total items written to ${TABLE_NAME}.`);
}

run();
