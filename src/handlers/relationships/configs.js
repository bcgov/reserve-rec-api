const { rulesFns } = require('../../common/validation-rules');

const rf = new rulesFns();

// Valid entity schemas for relationships
const VALID_SCHEMAS = ['activity', 'facility', 'geozone', 'product'];

/**
 * Configuration for relationship items
 * 
 * Relationship items store bidirectional links between entities:
 * - Forward query: pk = rel::{schema1}::{pk1}::{sk1}, sk = {schema2}::{pk2}::{sk2}
 * - Reverse query: gsipk = rel::{schema2}::{pk2}::{sk2}, gsisk = {schema1}::{pk1}::{sk1}
 */

const RELATIONSHIP_API_PUT_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  allowOverwrite: true,
  fields: {
    pk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
        rf.regexMatch(value, /^rel::/);
      }
    },
    sk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    gsipk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
        rf.regexMatch(value, /^rel::/);
      }
    },
    gsisk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    schema1: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
        rf.expectValueInList(value, VALID_SCHEMAS);
      }
    },
    schema2: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
        rf.expectValueInList(value, VALID_SCHEMAS);
      }
    },
    pk1: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    sk1: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    pk2: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    sk2: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['string']);
        rf.expectAction(action, ['set']);
      }
    },
    // Optional metadata fields
    metadata: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object', 'null']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const RELATIONSHIP_API_UPDATE_CONFIG = {
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
    metadata: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ['object', 'null']);
        rf.expectAction(action, ['set']);
      }
    }
  }
};

const RELATIONSHIP_API_DELETE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true
};

module.exports = {
  RELATIONSHIP_API_PUT_CONFIG,
  RELATIONSHIP_API_UPDATE_CONFIG,
  RELATIONSHIP_API_DELETE_CONFIG
};
