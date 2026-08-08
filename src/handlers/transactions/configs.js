"use strict";

const { rulesFns } = require("../../common/validation-rules");
const { TRANSACTION_STATUS_ENUMS } = require("../../common/data-constants");

const rf = new rulesFns();

const TRANSACTION_PUT_CONFIG = {
  failOnError: true,
  autoTimeStamp: true,
  autoVersion: true,
  allowOverwrite: false,
  fields: {
    pk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    sk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    amount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    bookingId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    clientTransactionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    date: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    globalId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    refundAmounts: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ["object"]);
        rf.expectAction(action, ["set"]);
      },
    },
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ["transaction"]);
        rf.expectAction(action, ["set"]);
      },
    },
    sessionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    status: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TRANSACTION_STATUS_ENUMS);
        rf.expectAction(action, ["set"]);
      },
    },
    userId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },

    // Items from Worldline Gateway
    cardAvsAddrMatch: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsMessage: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsPostalResult: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsProcessed: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["boolean", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsResult: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardBin: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardCvdId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string", "number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardLastFour: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardType: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },

    // Custom tracking fields
    customRef1: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef2: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef3: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef4: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef5: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },

    // Return parameters from Gateway Responses
    trnAmount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnApproved: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnAuthCode: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string", "number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnCustomerName: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnCreated: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnEmailAddress: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnMessage: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnOrderNumber: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnPaymentMethod: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnPhoneNumber: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnRiskScore: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnType: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnLinks: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ["object"]);
        rf.expectAction(action, ["set"]);
      },
    },
    metadata: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["object"]);
        rf.expectAction(action, ["set"]);
      },
    },
  },
};

const TRANSACTION_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    status: {
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TRANSACTION_STATUS_ENUMS);
        rf.expectAction(action, ["set"]);
      },
    },
    refundAmounts: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ["object"]);
        rf.expectAction(action, ["set"]);
      },
    },
  },
};

const REFUND_PUT_CONFIG = {
  failOnError: true,
  autoTimeStamp: true,
  autoVersion: true,
  allowOverwrite: false,
  fields: {
    pk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    sk: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    amount: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    bookingId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    date: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    globalId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    originalTransactionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    processorRefundId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    refundReason: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    refundSequence: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    refundTransactionId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    schema: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, ["refund"]);
        rf.expectAction(action, ["set"]);
      },
    },
    status: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TRANSACTION_STATUS_ENUMS);
        rf.expectAction(action, ["set"]);
      },
    },
    userId: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },

    // Items from Worldline Gateway
    cardAvsAddrMatch: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsMessage: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsPostalResult: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsProcessed: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["boolean", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardAvsResult: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardBin: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardCvdId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string", "number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardLastFour: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    cardType: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },

    // Custom tracking fields
    customRef1: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef2: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef3: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef4: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    customRef5: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },

    // Return parameters from Gateway Responses
    trnAmount: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnApproved: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnAuthCode: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string", "number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnCustomerName: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnCreated: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnEmailAddress: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnId: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnMessage: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnOrderNumber: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnPaymentMethod: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnPhoneNumber: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnRiskScore: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number", "string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnType: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    trnLinks: {
      rulesFn: ({ value, action }) => {
        rf.expectArray(value, ["object"]);
        rf.expectAction(action, ["set"]);
      },
    },
    metadata: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["object"]);
        rf.expectAction(action, ["set"]);
      },
    },
  },
};

const REFUND_UPDATE_CONFIG = {
  failOnError: true,
  autoTimestamp: true,
  autoVersion: true,
  fields: {
    refundReason: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["string"]);
        rf.expectAction(action, ["set"]);
      },
    },
    refundSequence: {
      rulesFn: ({ value, action }) => {
        rf.expectType(value, ["number"]);
        rf.expectAction(action, ["set"]);
      },
    },
    status: {
      isMandatory: true,
      rulesFn: ({ value, action }) => {
        rf.expectValueInList(value, TRANSACTION_STATUS_ENUMS);
        rf.expectAction(action, ["set"]);
      },
    },
  },
};

module.exports = {
  REFUND_PUT_CONFIG,
  REFUND_UPDATE_CONFIG,
  TRANSACTION_PUT_CONFIG,
  TRANSACTION_UPDATE_CONFIG,
};
