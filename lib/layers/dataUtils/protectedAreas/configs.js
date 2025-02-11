const { rulesFns } = require('/opt/validation-rules');

const rf = new rulesFns();

const PROTECTED_AREA_API_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    location: {
      rulesFn: ({value, action}) => {
        rf.expectGeopoint(value);
        rf.expectAction(action, ['set']);
      }
    },
  }
}

module.exports = {
  PROTECTED_AREA_API_UPDATE_CONFIG
}