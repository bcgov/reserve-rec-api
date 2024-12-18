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
  PRODUCT_DEFAULT_SCHEDULE_RANGE,
  PRODUCT_DAILY_PROPERTIES_CONFIG,
  PRODUCT_DEFAULT_PROPERTY_NAMES,
}