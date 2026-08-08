# Financial Data Models & Schemas

Transaction
-----------

A Transaction represents an immutable financial datapoint within the system, providing an authoritative audit trail (via Worldline/Bambora REST API payments) to the internal operational state of a reservation. It serves as a historical record tracking whether an allocation of funds succeeded or failed, capturing the raw payment gateway responses, authorization values, and the initiating identities.

Because financial capture is the final "gatekeeping" step for securing inventory, the system must write transaction items regardless if the payment succeeded or failed. Even when external payment providers reject a user's payment token (such as a card decline or network timeout), a Transaction item is successfully persisted with a `failed` state. This prevents silent failures and guarantees some tracing is available prior to throwing an error back to the client application or writing an administration log entry.

Transactions are processed using [Worldline's Custom Checkout](https://docs.na.worldline-solutions.com/build-your-integration/checkout-form/custom-checkout/setup) token authentication, securing payment handling by isolating primary account numbers (PAN) from the application databases. In standard checkout flows, successful transactions are executed alongside a booking state transition via multi-item writes (`batchTransactData`). For administrative overrides, the transaction payload captures the identity of the presiding administrative staff member (`adminId`), ensuring full operational visibility.

More information on [Worldline Redirect parameters here](https://docs.na.worldline-solutions.com/build-your-integration/checkout-form/checkout/redirect-parameters).

## Properties

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
| `refundAmounts` | Array | A historical log of all refund amounts applied against this transaction | Array of objects: `[{ [refundTransactionId]: refundAmount }]` | Reconciling the total original charge against subsequent administrative refunds to determine if a full or partial refund state is reached. |
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
| `metadata` | Object | The raw, unmutated JSON payload returned by the gateway | Worldline's `data` response object | Ensuring a complete historical snapshot is kept for deep auditing. |

### Refund

A Refund represents the return of funds to a user's original payment method. Refunds are heavily restricted and typically (first-pass / MVP) initiated by a system admin. They sit alongside the original `Transaction` in the database under the same partition key (`transaction::${bookingId}`) but are differentiated by their sort key (`refund::<date>::<refundTransactionId>`), ensuring a booking's complete financial history can be queried in a single database call.

A single transaction can have multiple partial refunds applied to it. The system automatically reconciles these totals to update the parent transaction status to either `"partial refund"` or `"refunded"` (full). 

#### Properties

| **property** | **type** | **description** | **derived from** | **evaluated when** |
| --- | --- | --- | --- | --- |
| `pk` | String | Partition key | `transaction::${bookingId}` | Grouping the refund with its parent booking and original transaction in a single partition. |
| `sk` | String | Sort key | `refund::${date}::${refundTransactionId}` | Querying all refunds for a booking using `begins_with(sk, "refund::")`. |
| `schema` | String | Data type classifier | `"refund"` | Identifying that this item is a return of funds. |
| `globalId` | String | Globally unique ID for the refund | `refundTransactionId` | Searching for a specific refund item directly via GSI. |
| `bookingId` | String | Unique identifier of the associated reservation | `bookingId` from the parent transaction | Linking the return to the parent booking. |
| `clientTransactionId` | String | The original transaction's UUID that the refund applies to | `clientTransactionId` | Auditing which specific payment attempt this refund reverses. |
| `refundTransactionId` | String | The authoritative refund ID generated by Worldline | Worldline's returned refund `id` | Tracking the refund event strictly at the payment provider layer. |
| `userId` | String | The unique identity of the user who owns the booking | `userId` | Associating the returned funds back to the user context. |
| `amount` | Number | The specific amount of funds returned in this request | `refundAmount` passed via the API payload | Determining how much to refund in Worldline and logging the returned value. |
| `date` | String | Localized calendar day the refund occurred | `getNow().toFormat("yyyy-LL-dd")` | Filtering and sorting refunds for daily reconciliation. |
| `createdAt` | String | Precise ISO timestamp of the refund | `getNowISO()` | Preserving the exact millisecond the refund was executed. |
| `status` | String | The state of the refund execution | `"refunded"`, `"refund in progress"`, or `"failed"` | Displaying accurate settlement progress to users and admins. |
| `refundSequence` | Number | The sequential number of this refund relative to others | Calculated dynamically during the idempotency lock check | Identifying if this is the 1st, 2nd, or nth partial refund against the transaction. |
| `message` | String | Human-readable gateway feedback | Worldline's `message` text | Providing failure context if the refund API call is rejected. |
| `metadata` | Object | The raw JSON payload returned by Worldline's return API | Worldline's full response object | Preserving a snapshot of the gateway interaction for debugging. |

---

### RefundHash

A RefundHash acts as a temporary, cryptographic idempotency lock within DynamoDB to prevent critical concurrency bugs (e.g., a "double refund" race condition). 

Because refunds rely on external API calls to a payment gateway, a user or admin accidentally double-clicking a "Refund" button could fire two identical requests at the exact same millisecond. Traditional JavaScript validation checks might query the database and see no prior refunds for *both* requests before either has time to write a result.

To solve this, the system generates a `RefundHash` using a time-bucketed formula before calling Worldline. This item is inserted into DynamoDB using an atomic conditional write (`attribute_not_exists`). If a duplicate request arrives in the same 3-minute window (adjustable), it produces the identical hash. DynamoDB will instantly reject the second write at the database level, aborting the duplicate API request before money is accidentally moved.

#### Properties

| **property** | **type** | **description** | **derived from** | **evaluated when** |
| --- | --- | --- | --- | --- |
| `pk` | String | Partition key | `refundHash::${dateKey}` | Partitioning idempotency locks by day for easy TTL expiration or cleanup. |
| `sk` | String | Sort key | SHA256 Hash string | Enforcing database-level uniqueness via conditional writes. |
| `schema` | String | Data type classifier | `"refundHash"` | Identifying the item as an idempotency lock. |
| `refundHash` | String | Cryptographic SHA256 signature of the refund attempt | Computed from `${userId}::${clientTransactionId}::${refundAmount}::${windowBucket}` | Ensuring two identical requests in the same time window produce the exact same lock string. |
| `globalId` | String | Globally unique identifier | Matches `refundHash` | Searching for a specific idempotency block via GSI if debugging concurrency failures. |
| `bookingId` | String | Associated booking ID | `bookingId` | Tracing the blocked/locked request back to the reservation. |
| `clientTransactionId` | String | Associated original transaction ID | `clientTransactionId` | Tracing the locked request back to the targeted payment. |
| `userId` | String | User ID associated with the booking | `userId` | Validating context during the hash generation. |
| `refundAmount` | Number | The requested refund amount | API request payload | Ensuring the hash is unique to the specific amount requested (allowing differently-priced refunds to process back-to-back). |
| `refundSequence` | Number | The sequential number this refund will be if successful | Pre-calculated from existing database records | Storing the expected sequence number before the external gateway call happens. |
| `totalRefundedBefore` | Number | The total amount refunded *prior* to this attempt | Pre-calculated from existing database records | Ensuring business logic limits aren't exceeded by parallel requests. |
| `createdAt` | String | Precise ISO timestamp | `getNowISO()` | Auditing exactly when the lock was acquired. |
