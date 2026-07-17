Transaction
-----------

A Transaction represents an immutable financial datapoint within the system, providing an authoritative audit trail (via Worldline/Bambora REST API payments) to the internal operational state of a reservation. It serves as a historical record tracking whether an allocation of funds succeeded or failed, capturing the raw payment gateway responses, authorization values, and the initiating identities.

Because financial capture is the final "gatekeeping" step for securing inventory, the system must write transaction items regardless if the payment succeeded or failed. Even when external payment providers reject a user's payment token (such as a card decline or network timeout), a Transaction item is successfully persisted with a `failed` state. This prevents silent failures and guarantees some tracing is available prior to throwing an error back to the client application or writing an administration log entry.

Transactions are processed using [Worldline's Custom Checkout](https://docs.na.worldline-solutions.com/build-your-integration/checkout-form/custom-checkout/setup) token authentication, securing payment handling by isolating primary account numbers (PAN) from the application databases. In standard checkout flows, successful transactions are executed alongside a booking state transition via multi-item writes (`batchTransactData`). For administrative overrides, the transaction payload captures the identity of the presiding administrative staff member (`adminId`), ensuring full operational visibility.

More information on [Worldline Redirect parameters here](https://docs.na.worldline-solutions.com/build-your-integration/checkout-form/checkout/redirect-parameters).

## Properties

## Transaction

| **property** | **type** | **description** | **derived from** | **evaluated when** |
| --- | --- | --- | --- | --- |
| `pk` | String | Partition key | `transaction::${bookingId}` | Searching for all payment and transaction attempts related to a specific [Booking](./bookings.md). Multiple payment attempts means duplicate `pk`s. |
| `sk` | String | Sort key | `${date}::${clientTransactionId}` | Search multiple transaction attempts or retries over time for the same booking context (disambiguated by `date` and `clientTransactionId`). |
| `schema` | String | Data type classifier / Schema identifier | `"transaction"` | Identifying that this item is a "transaction". |
| `globalId` | String | Globally unique UUID | Matches the `clientTransactionId` value | Searching for this specific item using the `globalId` GSI (same as `clientTransactionId`). |
| `bookingId` | String | Unique identifier of the associated reservation record | `bookingId` | Linking the transaction to its parent [Booking](./bookings.md). |
| `userId` | String | The unique identity `sub` of the user who owns the underlying booking | Provided via request routing or fetched from the authenticated [Booking](./bookings.md) record | Associating the transaction charge to the user. |
| `amount` | Number | The total captured amount evaluated by the Fee Policy at time of booking | `feeValues.bookingTotal` or `trnAmount` | Submitting the final calculated payload charge parameters to Worldline and storing the billing statement trace. |
| `clientTransactionId` | String | Unique client-side tracking UUID prefixed to prevent collision errors, prefixed with `BCPR-` | Automatically generated on request | Providing a unique transaction ID to the payment gateway for tracking, auditing, and reporting. |
| `date` | String | The localized calendar day the transaction request occurred (formatted `yyyy-LL-dd`) | Generated using `getNow().toFormat("yyyy-LL-dd")` | Filtering and sorting payment records for daily reconciliations or auditing. |
| `sessionId` | String | The unique workflow token tracking the web session | `sessionId` | Ensuring the transaction request was submitted from a valid checkout lifecycle window. |
| `status` | String | The state of the settlement attempt | Evaluated from the payment gateway outcome. Settled values: `"paid"` or `"failed"` | Determining if the system should proceed to complete the booking states or abort execution. |
| `cardAvsId` | String | Gateway-specific string identifier for the AVS state | Worldline's `card.avs.id` | Auditing detailed banking response states. |
| `cardAvsMessage` | String | Explanatory message from the network regarding address matching | Worldline's `card.avs.message` | Diagnosing failed transactions in admin logs. |
| `cardAvsProcessed` | Boolean/String | Flag indicating if AVS verification was attempted | Worldline's `card.avs.processed` | Checking gateway verification compliance. |
| `cardAvsAddrMatch` | Number/String | Address Verification Service street match flag | Worldline's `card.address_match` | Reviewing fraud flags during dispute resolutions. |
| `cardAvsPostalResult` | Number/String | Address Verification Service postal/zip match flag | Worldline's `card.postal_result` | Reviewing fraud flags during dispute resolutions. |
| `cardBin` | String | The Bank Identification Number of the card used | Worldline's `card.card_bin` | Analyzing issuer data or blocking specific bins if necessary. |
| `cardLastFour` | String | The last four digits of the primary account number (PAN) | Worldline's `card.last_four` | Providing identifiable card context to the user without storing sensitive full PANs. |
| `cardType` | String | The brand/type of the credit card used | Worldline's `card.card_type` (e.g., `"VI"`) | Displaying payment context in admin receipts or reports. |
| `customRef1` | String | Custom tracking token mapping back to the reservation | Worldline's `custom.ref1` (`bookingId`) | Validating callback lifecycle matching. |
| `customRef2` | String | Custom tracking token mapping back to the checkout session | Worldline's `custom.ref2` (`sessionId`) | Tracking checkout session lifecycles. |
| `trnAmount` | Number | The final transaction amount echoed back from the gateway | Worldline's `amount` | Reconciling internal expected amounts with actual gateway charges. |
| `trnApproved` | String | Stringified boolean showing explicit gateway clearance status | Worldline's `approved` (`"1"` if payment is approved, `"0"` if declined) | Providing scannable boolean validation criteria for downstream transaction pipelines. |
| `trnAuthCode` | String/Number | The precise authorization approval alphanumeric string from the card issuer | Worldline's `auth_code` returned from a successful credit check payload | Preserving the banking system audit validation proof for secure reconciliation. |
| `trnCreated` | String | The timestamp the transaction was finalized in the gateway | Worldline's `created` | Auditing the exact processing time at the provider level. |
| `trnId` | String | The authoritative transaction tracking ID generated by Worldline | Worldline's `id` returned from the Worldline API layer | Storing the external reference code, necessary to issue refunds or charge voids. |
| `trnLinks` | Object | The related Worldline links for refunds and voids | Worldline's `links` object returned from the Worldline API layer | Providing the related links to issue refunds and voids for an order. The link contains the `trnId`, e.g. `https://api.na.bambora.com/v1/payments/<id>/returns` |
| `trnMessage` | String | Human-readable feedback returned directly from the terminal network | Worldline's `message` text | Providing concise descriptive error strings for system logs and frontend decline feedback notifications. |
| `trnPaymentMethod` | String | The method of payment processed | Worldline's `payment_method` (e.g., `"CC"`) | Auditing how the transaction was funded. |
| `trnRiskScore` | Number/String | Fraud risk matrix score calculated by the gateway | Worldline's `risk_score` | Flagging suspicious booking requests automatically. |
| `metadata` | Object | The raw, unmutated JSON payload returned by the gateway | Worldline's `data` response object in its entirety | Ensuring a complete historical snapshot is kept in case debugging or deep auditing is required. |
