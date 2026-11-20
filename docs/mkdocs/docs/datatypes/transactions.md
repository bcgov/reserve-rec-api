# Financial Data Models & Schemas

Transaction
-----------

A Transaction represents an immutable financial datapoint within the system, providing an authoritative audit trail (via Worldline/Bambora REST API payments) to the internal operational state of a reservation. It serves as a historical record tracking whether an allocation of funds succeeded or failed, capturing the raw payment gateway responses, authorization values, and the initiating identities.

Each payment attempt is written as a Transaction in `in progress` before Worldline is called, then moved to its outcome. A decline is stored as `failed`. When Worldline gives no answer (timeout, dropped connection or 5xx) the card may still have been charged, so the attempt is stored as `unknown` and the client gets a 502 telling it not to pay again. Every change is appended to `statusHistory`.

A booking can be paid once. The [PaymentLock](#paymentlock) item enforces this, so a double submit, two tabs, or an admin and the owner paying at the same time charge the card once. Before charging, the booking completion is checked with the occupant fields sent in the payment request, so a refusal (expired session, unverified email) happens before any money moves.

Transactions are processed using [Worldline's Custom Checkout](https://docs.na.worldline-solutions.com/build-your-integration/checkout-form/custom-checkout/setup) token authentication, securing payment handling by isolating primary account numbers (PAN) from the application databases. A successful charge is committed in one DynamoDB transaction with the PaymentLock and the booking confirmation. If the booking can no longer be confirmed by then, the attempt is first stored as `paid`, with `bookingCompletionFailed` and `needsReconciliation` set, and the charge is then voided (`POST /v1/payments/{trnId}/void` with the exact amount). An approved void moves the attempt and the PaymentLock to `void` and clears `needsReconciliation`. A refused void (Worldline voids only on the day of the charge, message 205 after that), an error or no answer leaves the attempt `paid` with `needsReconciliation` and logs `event=payment_void_failed`; nothing is refunded automatically. Either way the request returns 500, with a message and `data.chargeReversed` saying whether the charge was reversed. For administrative overrides, the transaction payload captures the identity of the presiding administrative staff member (`adminId`), ensuring full operational visibility.

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
| `amount` | Number | The total captured amount evaluated by the Fee Policy at time of booking | The booking's `feePolicySnapshot.feeInformation.total`, else its `feeValues.bookingTotal`, never the request; a booking without a positive total is refused | Submitting the final calculated payload charge parameters to Worldline and storing the billing statement trace. |
| `clientTransactionId` | String | Unique client-side tracking UUID prefixed to prevent collision errors, prefixed with `BCPR-` | Automatically generated on request | Providing a unique transaction ID to the payment gateway for tracking, auditing, and reporting. |
| `date` | String | The localized calendar day the transaction request occurred (formatted `yyyy-LL-dd`) | Generated using `getNow().toFormat("yyyy-LL-dd")` | Filtering and sorting payment records for daily reconciliations or auditing. |
| `sessionId` | String | The unique workflow token tracking the web session | `sessionId` | Ensuring the transaction request was submitted from a valid checkout lifecycle window. |
| `status` | String | The state of the payment attempt | See [Payment statuses](#payment-statuses). Refunds later set `"refund in progress"`, `"partial refund"` or `"refunded"` | Determining if the system should proceed to complete the booking states or abort execution. |
| `statusHistory` | Array | Every status the attempt has had | `[{ status, at, source, providerMessage?, providerTrnId? }]`, appended on each change | Auditing an attempt's lifecycle. |
| `attemptNumber` | Number | Which attempt this is for the booking, starting at 1 | The PaymentLock's `attemptCount` + 1 | Following retries after a decline. |
| `source` | String | Who started the payment | `"public"` or `"admin"` | Auditing admin payments. |
| `adminId` | String | The admin who started an admin payment | The admin's `sub` | Auditing admin payments. |
| `bookingCompletionFailed` | Boolean | The card was charged but the booking could not be confirmed | Set when the booking update's condition fails after an approved charge | Finding charges to void or refund. |
| `needsReconciliation` | Boolean | The attempt needs an admin to check it against Worldline | Set with `bookingCompletionFailed`, or when reconciliation finds a stuck attempt was approved; cleared by a void | Finding attempts to reconcile. |
| `providerMismatch` | Boolean | Worldline reported a different outcome than the one stored | Reserved for Worldline notifications | Finding attempts to reconcile. |
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

### Payment statuses

| **status** | **meaning** | **next** |
| --- | --- | --- |
| `in progress` | Lock held, Worldline call in flight | `paid`, `failed`, `unknown` |
| `in progress` older than 5 minutes | The request that held the lock is gone | `paid` or `failed`, set by reconciliation |
| `paid` | Worldline approved the charge | `void` |
| `failed` | Worldline declined or rejected the request; nothing was charged | final for the attempt; the booking may try again |
| `unknown` | No answer from Worldline; the card may have been charged | `paid` or `failed`, set by reconciliation |
| `void` | An approved charge was voided | final for the attempt; the booking may try again |

Every change is a conditional write on the previous status, for both the attempt and the PaymentLock.

### PaymentLock

One item per booking that allows a single payment at a time and a single successful payment in total. It sits under the booking's transaction partition, and the transaction lists for a booking (`GET /transactions/{bookingId}`, admin and public) leave it out.

Taking the lock and writing the `in progress` attempt is one transaction. The lock update's condition is `attribute_not_exists(pk) OR ((#status = :failed OR #status = :void) AND attemptCount = :previousAttemptCount)`, where `:previousAttemptCount` is the count read just before. Of two concurrent requests, one wins and the other gets a 409.

The session timer applies until payment starts, and its rules do not change: a payment can start only while the hold is live, and the timer is never extended. The lock transaction includes a condition check on the booking (`isPending`, `in progress`, and `sessionExpiry` not passed), so a hold that expired or was released before the lock gets 410 and no card is charged. After that, the incomplete-booking scraper leaves the booking alone: it times out an expired hold only in a transaction that also checks the booking's PaymentLock is absent, `failed` or `void`. A hold whose payment is `in progress`, `unknown` or `paid` stays until that payment settles or an admin resolves it, and the scraper logs `event=hold_kept_for_payment` each time it passes over it.

| **lock status** | **a new payment request gets** |
| --- | --- |
| none, or `failed` or `void` with fewer than 5 attempts | a new attempt with a new `clientTransactionId` |
| `in progress` or `unknown` | 409, `refusal: "duplicate_payment"`, "A payment for this booking is already being processed" |
| `paid` (or the booking is `confirmed`) | 409, `refusal: "duplicate_payment"`, "Booking has already been paid" |
| `failed` or `void` after 5 attempts | 409, `refusal: "payment_attempts_exhausted"` |

A refused duplicate increments `duplicateAttempts` on the lock; admin requests also write an `ADMIN_PAYMENT_DUPLICATE` audit entry.

#### Reconciliation

A lock in `unknown`, or in `in progress` with `pendingSince` more than 5 minutes ago, is reconciled before the next payment request is judged. Worldline's Reporting API is searched for a purchase (transaction type `P`, so a void under the same order number is never read as the charge) with the attempt's `clientTransactionId` as its `order_number`, between a day before and a day after `pendingSince`, since the merchant account's timezone is not known here. A record found is confirmed with `GET /v1/payments/{trn_id}`, and its `approved` field decides the outcome:

| **Worldline says** | **attempt and lock become** | **the payment request gets** |
| --- | --- | --- |
| approved | `paid`, with `needsReconciliation` (the booking is not confirmed here) | 409 "Booking has already been paid" |
| declined | `failed` | a new attempt |
| no record, `pendingSince` 30 minutes or less ago | unchanged; Search may not list a fresh charge yet | 409 "already being processed" |
| no record, `pendingSince` more than 30 minutes ago | `failed`; nothing was charged | a new attempt |
| lookup failed | unchanged | 409 "already being processed" |

Each run logs `event=payment_reconciled` with `outcome` `approved`, `declined`, `not_found`, `not_found_waiting`, `lookup_failed` or `skipped`. The search uses the Reporting API passcode from the secret named by `REPORTING_API_SECRET`; when that variable is unset the lookup is skipped (`skipped`) and the lock keeps blocking payment until an admin settles it by hand (see below).

`REPORTING_API_SECRET` is set on the payment functions only when the stack's `reportingApiPasscode` secret (`/reserveRecApi/<env>/publicApiStack/reportingApiPasscode`, and the same under `adminApiStack`) could be read at deploy time; create the secret and redeploy to turn lookups on.

#### Admin reconcile route

`POST /transactions/admin/{bookingId}/reconcile` on the admin API runs the same reconciliation on demand, without waiting for the next payment request. Superadmins only. It returns 200 with `{ lock, attempt }` as they stand afterwards (`attempt` is `null` when the lock was not stuck or the lookup was skipped), or 404 when the booking has no PaymentLock. Each call writes an `ADMIN_PAYMENT_RECONCILE` audit entry against the lock's `activeClientTransactionId` (`ADMIN_PAYMENT_RECONCILE_FAILURE` when it fails) and logs `event=payment_reconcile_requested` or `event=payment_reconcile_not_found`.

An approved charge found this way is marked `paid` with `needsReconciliation`; the booking is not confirmed and nothing is refunded, so an admin still has to finish or refund the booking. The same transaction sets the booking's `clientTransactionId` to the paid attempt, as a normal payment does, so a refund finds the charge.

When the lookup cannot settle the lock (no Reporting API passcode, or Worldline unreachable), the admin can settle it by hand after checking the order in the Worldline member area. Send a body of `{ "status": "failed" | "paid", "reason": "<what was checked>" }`; both fields are required. The lock must be stuck, as defined above, or the call answers 409. `failed` frees the booking for a new attempt; `paid` sets `needsReconciliation` and the booking's `clientTransactionId` and, as above, does not confirm the booking. The attempt's `statusHistory` entry records `source: "admin"`, the admin's id and the reason. The call writes an `ADMIN_PAYMENT_SETTLE` audit entry with the reason and logs `event=payment_settled_manually`. If another request settles the lock first, it answers 409 and nothing is written.

#### Alarms

Every `event=payment_*` line becomes a metric in `ReserveRecApi/<env>`, summed over the public POST, admin POST and reconcile functions. These alarm at 1 or more in 5 minutes:

| **alarm** | **means** |
| --- | --- |
| `payment_unconfirmed` | Worldline gave no answer; the card may have been charged and the lock is `unknown` |
| `payment_booking_completion_failed` | a card was charged but its booking could not be confirmed |
| `payment_void_failed` | the void of such a charge was refused or got no answer; the card stays charged |
| `payment_record_failed` | a payment outcome could not be written to the attempt and lock |

The alarms are created with the admin transactions functions, which every environment deploys, so they exist even where public transactions are disabled. They have no actions and show on the overview dashboard. Thresholds can be changed through the admin API stack's `eventAlarms` config.

#### Properties

| **property** | **type** | **description** |
| --- | --- | --- |
| `pk` | String | `transaction::${bookingId}` |
| `sk` | String | `"payment"` |
| `schema` | String | `"paymentLock"` |
| `bookingId`, `userId` | String | The booking and its owner |
| `status` | String | Status of the latest attempt, from [Payment statuses](#payment-statuses) |
| `activeClientTransactionId` | String | The latest attempt's `clientTransactionId` |
| `successfulClientTransactionId` | String | The attempt that was charged, once `paid` |
| `attemptCount` | Number | Attempts started for this booking |
| `duplicateAttempts` | Number | Requests refused as duplicates |
| `lastDuplicateAt`, `pendingSince`, `lastUpdated` | String | ISO timestamps |
| `bookingCompletionFailed`, `needsReconciliation` | Boolean | Copied from the attempt when a charge could not confirm the booking |

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
