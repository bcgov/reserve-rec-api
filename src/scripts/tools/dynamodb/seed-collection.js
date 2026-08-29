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
      location: { lat: 49.963373, lng: -122.670368 },
      envelope: {
        ne: { lat: 49.96, lng: -122.67 },
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
          location: { lat: 49.963373, lng: -122.670368 },
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
              displayName: "Cheakamus Day-use Pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Cheakamus Day-use Pass - AM",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 49,
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
                {
                  id: 2,
                  displayName: "Cheakamus Day-use Pass - PM",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 39,
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
          location: { lat: 49.963373, lng: -122.670368 },
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
              displayName: "Diamond Head Day-use Pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Diamond Head Day-use Pass - All day",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 55,
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
          location: { lat: 49.963373, lng: -122.670368 },
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
              displayName: "Rubble Creek Day-use Pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Rubble Creek Day-use Pass - All day",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 230,
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
    location: { lat: 49.499726, lng: -122.450121 },
    envelope: {
      ne: { lat: 49.49, lng: -122.45 },
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
          facilitySubType: 'parkingLot',
        id: 1,
        displayName: "Alouette Lake Boat Launch Parking",
        location: { lat: 49.499726, lng: -122.450121 },
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
            displayName: "Alouette Lake Boat Launch Parking Pass",
            activitySubType: "vehicleParking",
            products: [
              {
                id: 1,
                displayName: "Alouette Lake Boat Launch Parking - All day",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 200,
                timezone: "America/Vancouver",
              },
            ],
          },
        ],
      },
      {
        type: "structure",
          facilitySubType: 'parkingLot',
        id: 2,
        displayName: "Alouette Lake South Beach Day-Use Parking Lot",
        location: { lat: 49.499726, lng: -122.450121 },
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
            displayName: "Alouette Lake South Beach Day-Use Parking Lot Pass",
            activitySubType: "vehicleParking",
            products: [
              {
                id: 1,
                displayName:
                  "Alouette Lake South Beach Day-Use Parking Lot - AM",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 79,
                timezone: "America/Vancouver",
              },
              {
                id: 2,
                displayName:
                  "Alouette Lake South Beach Day-Use Parking Lot - PM",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 42,
                timezone: "America/Vancouver",
              },
            ],
          },
        ],
      },
      {
        type: "structure",
          facilitySubType: 'parkingLot',
        id: 3,
        displayName: "Gold Creek Parking Lot",
        location: { lat: 49.499726, lng: -122.450121 },
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
            displayName: "Gold Creek Parking Lot Pass",
            activitySubType: "vehicleParking",
            products: [
              {
                id: 1,
                displayName: "Gold Creek Parking Lot - AM",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 110,
                timezone: "America/Vancouver",
              },
              {
                id: 2,
                displayName: "Gold Creek Parking Lot - PM",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 60,
                timezone: "America/Vancouver",
              },
            ],
          },
        ],
      },
      {
        type: "structure",
          facilitySubType: 'parkingLot',
        id: 4,
        displayName: "West Canyon Trailhead Parking Lot",
        location: { lat: 49.499726, lng: -122.450121 },
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
            displayName: "West Canyon Trailhead Parking Lot Pass",
            activitySubType: "vehicleParking",
            products: [
              {
                id: 1,
                displayName: "West Canyon Trailhead Parking Lot - AM",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 55,
                timezone: "America/Vancouver",
              },
              {
                id: 2,
                displayName: "West Canyon Trailhead Parking Lot - PM",
                isVisible: true,
                passesRequired: true,
                qrCodeEnabled: true,
                startDate: "2026-03-20",
                endDate: "2026-09-15",
                capacity: 30,
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
      location: { lat: 49.38852, lng: -122.91933 },
      envelope: {
        ne: { lat: 49.38, lng: -122.91 },
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
          displayName: "Daily Additional P1 and Lower P5",
          location: { lat: 49.38852, lng: -122.91933 },
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
              displayName: "Daily Additional P1 and Lower P5 Pass",
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
          location: { lat: 49.38852, lng: -122.91933 },
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
              displayName: "P1 and Lower P5 Pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "P1 and Lower P5 Pass - AM",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 200,
                  timezone: "America/Vancouver",
                  isVisible: true,
                  passesRequired: true,
                  qrCodeEnabled: true,
                },
                {
                  id: 2,
                  displayName: "P1 and Lower P5 Pass - PM",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 200,
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
      location: { lat: 50.344139, lng: -122.477854 },
      envelope: {
        ne: { lat: 50.37, lng: -122.43 },
        sw: { lat: 50.32, lng: -122.53 },
      },
      timezone: "America/Vancouver",
      isVisible: true,
      minMapZoom: 8,
      maxMapZoom: 18,
      imageUrl:
        "https://nrs.objectstore.gov.bc.ca/kuwyyf/RS_1963_BC_Parks_Educational_07091_gal_9a12125f44.jpg",
      parkLink: "https://bcparks.ca/joffre-lakes-park/",
      searchTerms: [],

      // Each facility has a type, id, displayName, and a list of activities.
      // Each activity has a type, id, displayName, and a list of products.
      // Each product has a date range and capacity, and uses asset::pass::1.
      facilities: [
        {
          type: "structure",
          facilitySubType: 'parkingLot',
          id: 1,
          displayName: "Joffre Lakes",
          location: { lat: 50.344139, lng: -122.477854 },
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
              displayName: "Joffre Lakes Day-use Pass",
              activitySubType: "vehicleParking",
              products: [
                {
                  id: 1,
                  displayName: "Joffre Lakes Day-use Pass - All day",
                  startDate: "2026-03-20",
                  endDate: "2026-09-15",
                  capacity: 200,
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

/**
 * Generates all dates between startDate and endDate (inclusive), YYYY-MM-DD strings.
 */
function buildDateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
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

const POLICY_PARTY = {
  pk: 'policy::party::1',
  sk: 'v1',
  createdAt: '2026-02-25T10:00:00Z',
  description: 'This is the standard party policy for day-use offerings in summer 2026. It allows parties to be composed of 1 to 4 people (passes). There are no specific rules around party composition for this policy.',
  displayName: 'Standard Day Use Party Policy #1 (Summer 2026)',
  globalId: 'd9f8c7e6-5a4b-4c3d-9e2f-1a0b5c6d7e8f',
  gsipk: 'policy::party',
  gsisk: 'true',
  isLatest: true,
  lastUpdated: '2026-02-25T10:00:00Z',
  policyId: '1',
  policyIdVersion: 1,
  policyType: 'party',
  productRules: {
    partyCategories: [{ id: 'passes', label: 'Number of Passes', maxCount: 4, minCount: 1 }],
    partyCompositionRules: [],
  },
  schema: 'policy',
};

// productDateRules from policy::reservation::1 — embedded as reservationPolicy on productDate
const RESERVATION_POLICY_DATE_RULES = {
  isDiscoverable: true,
  isReservable: true,
  maxDailyInventory: 4,
  minDailyInventory: 1,
  temporalAnchors: [
    { fixedDateTime: '2026-04-15', id: 'discoveryWindowOpen', label: 'Discovery Window Open', timeOfDay: { hour: 7 } },
    { fixedDateTime: '2026-12-31T23:59:59-08:00', id: 'discoveryWindowClose', label: 'Discovery Window Close', timeOfDay: { hour: 17 } },
    { anchorRef: 'productDate', id: 'checkInTime', label: 'Check-In Time', timeOfDay: { hour: 7 } },
    { anchorRef: 'productDate', id: 'checkOutTime', label: 'Check-Out Time', timeOfDay: { hour: 17 } },
    { anchorRef: 'productDate', duration: { days: 1, direction: 'after' }, id: 'noShowTime', label: 'No-Show Time', timeOfDay: { hour: 17 } },
  ],
  temporalWindows: [
    {
      id: 'discoveryWindow', label: 'Discovery Window',
      open: { anchorRef: 'productDate', duration: { direction: 'before', weeks: 3 }, keepInputTime: true },
      close: { anchorRef: 'productDate', duration: { direction: 'after', weeks: 1 }, keepInputTime: true },
    },
    {
      id: 'reservationWindow', label: 'Reservation Window',
      open: { anchorRef: 'productDate', duration: { direction: 'before', weeks: 2 }, timeOfDay: { hour: 7 } },
      close: { anchorRef: 'productDate', timeOfDay: { hour: 17 } },
    },
  ],
};

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
 * Computes the reservationContext for a productDate given the standard reservation policy.
 * All temporal values are epoch milliseconds.
 */
function computeReservationContext(date, timezone) {
  const checkInMs       = localToEpochMs(date, 7, timezone);
  const checkOutMs      = localToEpochMs(date, 17, timezone);
  const noShowMs        = localToEpochMs(addDays(date, 1), 17, timezone);

  const discoveryWindowOpenMs  = localToEpochMs('2026-04-15', 7, timezone);
  const discoveryWindowCloseMs = localToEpochMs('2026-12-31', 17, timezone);

  // Discovery window: date ± weeks at midnight in local timezone (keepInputTime = true)
  const discoveryOpenMs   = localToEpochMs(addDays(date, -21), 0, timezone);
  const discoveryCloseMs  = localToEpochMs(addDays(date,   7), 0, timezone);

  // Reservation window: date - 2 weeks at hour 7, closes at checkOut
  const reservationOpenMs = localToEpochMs(addDays(date, -14), 7, timezone);

  return {
    isDiscoverable: true,
    isReservable: true,
    maxDailyInventory: 4,
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
          partyPolicy:       { primaryKey: { pk: 'policy::party::1',       sk: 'v1' } },
          reservationPolicy: {
            isDiscoverable: true,
            isReservable: true,
            maxTotalDays: 14,
            minTotalDays: 1,
            primaryKey: { pk: 'policy::reservation::1', sk: 'v1' },
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
        const dates = buildDateRange(product.startDate, product.endDate);
        for (const date of dates) {
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
            partyPolicy:       POLICY_PARTY,
            reservationPolicy: RESERVATION_POLICY_DATE_RULES,
            reservationContext: computeReservationContext(date, product.timezone),
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
        const dates = buildDateRange(product.startDate, product.endDate);
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
