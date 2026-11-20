"use strict";

// Worldline (Bambora) REST calls for token payments. Every URL derives from WORLDLINE_PAYMENT_API_URL.
const axios = require("axios");
const { DateTime } = require("luxon");
const {
  SecretsManagerClient,
  GetSecretValueCommand,
} = require("@aws-sdk/client-secrets-manager");
const { logger } = require("/opt/base");

const secretsClient = new SecretsManagerClient({
  region: process.env.AWS_REGION || "ca-central-1",
});
const cachedSecrets = {};

// Well below the 25 s Lambda timeout, so a slow provider is recorded as UNKNOWN rather than lost.
const PAYMENT_PROVIDER_TIMEOUT_MS = 7000;
// Lookups run before a charge in the same request, so two of them plus the charge fit in 25 s.
const LOOKUP_TIMEOUT_MS = 3000;

/**
 * Reads a secret from Secrets Manager by its path, cached for the life of the container.
 * @param {string} secretPath - The secret's name (e.g. process.env.MERCHANT_ID_SECRET).
 * @returns {Promise<string>} The plaintext secret value.
 */
async function getSecret(secretPath) {
  if (!secretPath) {
    throw new Error("Cannot retrieve secret: secretPath is undefined or empty.");
  }
  if (cachedSecrets[secretPath]) {
    return cachedSecrets[secretPath];
  }
  try {
    const response = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: secretPath }),
    );
    cachedSecrets[secretPath] = response.SecretString;
    return cachedSecrets[secretPath];
  } catch (error) {
    logger.error(`Error retrieving secret [${secretPath}] from Secrets Manager:`, error?.message);
    throw error;
  }
}

function paymentsUrl() {
  return process.env.WORLDLINE_PAYMENT_API_URL;
}

// A failure here means nothing reached Worldline; `providerNotCalled` lets callers tell it apart.
async function requestOptions(passcodeSecretPath, timeout) {
  let merchantId, passcode;
  try {
    if (!paymentsUrl()) throw new Error("WORLDLINE_PAYMENT_API_URL is not set");
    merchantId = await getSecret(process.env.MERCHANT_ID_SECRET);
    passcode = await getSecret(passcodeSecretPath);
  } catch (error) {
    throw Object.assign(error, { providerNotCalled: true });
  }
  const token = Buffer.from(`${merchantId}:${passcode}`).toString("base64");
  return {
    headers: { Authorization: `Passcode ${token}`, "Content-Type": "application/json" },
    timeout,
  };
}

function isApproved(data) {
  return data?.approved === 1 || data?.approved === true || data?.approved === "1";
}

/** POST /v1/payments. Resolves with the PaymentResponse; rejects with the axios error. */
async function chargePayment(payload) {
  const options = await requestOptions(process.env.PAYMENTS_API_SECRET, PAYMENT_PROVIDER_TIMEOUT_MS);
  const res = await axios.post(paymentsUrl(), payload, options);
  return res.data;
}

/** POST /v1/payments/{trnId}/void; Worldline requires the exact original amount. */
async function voidPayment(trnId, amount) {
  const options = await requestOptions(process.env.PAYMENTS_API_SECRET, PAYMENT_PROVIDER_TIMEOUT_MS);
  const res = await axios.post(`${paymentsUrl()}/${trnId}/void`, { amount }, options);
  return res.data;
}

/** GET /v1/payments/{trnId}. */
async function getPayment(trnId) {
  const options = await requestOptions(process.env.PAYMENTS_API_SECRET, LOOKUP_TIMEOUT_MS);
  const res = await axios.get(`${paymentsUrl()}/${trnId}`, options);
  return res.data;
}

/** Whether a Reporting API passcode is configured, so order-number lookups can run. */
function canSearchPayments() {
  return Boolean(process.env.REPORTING_API_SECRET);
}

/**
 * Reporting API search for the transaction with this order number, created between `from` and `to`
 * (ISO timestamps). Resolves with the first record, or null when there is none.
 */
async function findPaymentByOrderNumber(orderNumber, from, to) {
  const options = await requestOptions(process.env.REPORTING_API_SECRET, LOOKUP_TIMEOUT_MS);
  const format = (iso) => DateTime.fromISO(iso, { zone: "utc" }).toFormat("yyyy-LL-dd'T'HH:mm:ss");
  const res = await axios.post(
    paymentsUrl().replace(/\/payments\/?$/, "/reports"),
    {
      name: "Search",
      start_date: format(from),
      end_date: format(to),
      start_row: "1",
      end_row: "2",
      // Field 5 is the order number, 8 the transaction type; "P" (purchase) skips a void under the same order.
      criteria: [
        { field: "5", operator: "%3D", value: orderNumber },
        { field: "8", operator: "%3D", value: "P" },
      ],
    },
    options,
  );
  return res.data?.records?.[0] ?? null;
}

module.exports = {
  canSearchPayments,
  chargePayment,
  findPaymentByOrderNumber,
  getPayment,
  getSecret,
  isApproved,
  voidPayment,
};
