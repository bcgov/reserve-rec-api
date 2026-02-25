const refDataIndexMappingOptions = {
  properties: {
    // location
    location: {
      type: 'geo_point'
    },
    // boundary
    boundary: {
      type: 'geo_shape'
    },
    // path
    path: {
      type: 'geo_shape'
    },
    // envelope
    envelope: {
      type: 'geo_shape'
    },
    // geozone
    geozone: {
      type: 'object'
    },
    // facility
    facilities: {
      type: 'object'
    },
    // activity
    activities: {
      type: 'object'
    },
    // policies
    bookingPolicy: {
      type: 'object'
    },
    changePolicy: {
      type: 'object'
    },
    partyPolicy: {
      type: 'object'
    },
    feePolicy: {
      type: 'object'
    }
  }
};

const transDataIndexMappingOptions = {
  properties: {
    // Booking fields
    bookingId: { type: 'keyword' },
    globalId: { type: 'keyword' },
    startDate: { type: 'date', format: 'yyyy-MM-dd||yyyy-MM-dd\'T\'HH:mm:ss\'Z\'||yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'' },
    endDate: { type: 'date', format: 'yyyy-MM-dd||yyyy-MM-dd\'T\'HH:mm:ss\'Z\'||yyyy-MM-dd\'T\'HH:mm:ss.SSS\'Z\'' },
    displayName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    bookingStatus: { type: 'keyword' },
    bookedAt: { type: 'date' },
    user: { type: 'keyword' },
    activityType: { type: 'keyword' },
    activityId: { type: 'keyword' },
    collectionId: { type: 'keyword' },
    sessionId: { type: 'keyword' },
    rateClass: { type: 'keyword' },
    timezone: { type: 'keyword' },

    // Complex objects
    entryPoint: { type: 'object' },
    exitPoint: { type: 'object' },
    namedOccupant: { type: 'object' },
    partyInformation: { type: 'object' },
    feeInformation: { type: 'object' },
    vehicleInformation: { type: 'text' },
    equipmentInformation: { type: 'text' },

    // User fields
    username: { type: 'keyword' },
    sub: { type: 'keyword' },
    email: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    email_verified: { type: 'boolean' },
    givenName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    familyName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    phoneNumber: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    phone_number_verified: { type: 'boolean' },
    mobilePhone: { type: 'text' },
    postalCode: { type: 'keyword' },
    province: { type: 'keyword' },
    streetAddress: { type: 'text' },
    licensePlate: { type: 'keyword' },
    vehicleRegLocale: { type: 'keyword' },
    secondaryNumber: { type: 'text' },
    userPoolId: { type: 'keyword' },
    userStatus: { type: 'keyword' },
    enabled: { type: 'boolean' },

    // Geospatial
    location: { type: 'geo_point' },

    // Search fields
    searchTerms: { type: 'text' },

    // Metadata
    schema: { type: 'keyword' },
    version: { type: 'integer' },
    createdAt: { type: 'date' },
    lastModified: { type: 'date' },
    lastUpdated: { type: 'date' },
    pk: { type: 'keyword' },
    sk: { type: 'keyword' }
  }
};

const userIndexMappingOptions = {
  properties: {
    // User fields
    username: { type: 'keyword' },
    sub: { type: 'keyword' },
    email: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    email_verified: { type: 'boolean' },
    givenName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    familyName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    phoneNumber: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' }
      }
    },
    phone_number_verified: { type: 'boolean' },
    mobilePhone: { type: 'text' },
    postalCode: { type: 'keyword' },
    province: { type: 'keyword' },
    streetAddress: { type: 'text' },
    licensePlate: { type: 'keyword' },
    vehicleRegLocale: { type: 'keyword' },
    secondaryNumber: { type: 'text' },
    userPoolId: { type: 'keyword' },
    userStatus: { type: 'keyword' },
    enabled: { type: 'boolean' },

    // Metadata
    schema: { type: 'keyword' },
    version: { type: 'integer' },
    createdAt: { type: 'date' },
    lastModified: { type: 'date' },
    lastUpdated: { type: 'date' },
    pk: { type: 'keyword' },
    sk: { type: 'keyword' }
  }
};

module.exports = {
  refDataIndexMappingOptions,
  transDataIndexMappingOptions,
  userIndexMappingOptions
};