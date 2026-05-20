# Booking Workflow Stack

## Overview

The Booking Workflow Stack owns the asynchronous parts of the booking lifecycle: the refund pipeline, the inventory-return + expired-booking scraper, and SMS reminders. Cancellations themselves currently run synchronously inside the cancel POST handler — see the next section.

### Infrastructure Components

**SNS Topics:**
- `reserve-rec-refund-requests` - Coordinates refund processing with fan-out pattern

**SQS Queues:**
- `refund-request-queue` - Buffers refund requests for processing
- `worldline-request-queue` - Queues Worldline API refund requests
- `inventory-return-queue` - Buffers inventory restoration requests
- `sms-reminder-queue` - Buffers SMS reminder dispatch
- Dead Letter Queues (DLQs) for failed message handling with 14-day retention

**Lambda Functions:**
- `RefundSubscriber` - Validates and initiates refunds (refund pipeline pending)
- `WorldlineProcessor` - Submits refund requests to Worldline API
- `InventoryReturnProcessor` - Returns inventory from a queued booking back to its pool
- `SmsReminderProcessor` - Sends booking reminder SMS messages
- `ExpiredBookingCleanupFn` (`incompleteBookingScraper`) - EventBridge-scheduled (default every 15 min). Sweeps `isPending = PENDING` bookings: returns inventory for cancelled ones, marks abandoned in-progress sessions as `TIMED_OUT`.

> Refunds are not wired end-to-end yet — payment + Worldline integration are still in progress. The pieces above are scaffolding for that work.

---

## Booking Cancellation Workflow

Cancellation is handled synchronously by the public API. There is no SNS hop today.

### 1. User initiates cancellation

A user cancels a booking from their `my-bookings` page → `POST /bookings/{bookingId}/cancel`.

### 2. Cancel POST handler (`src/handlers/bookings/_bookingId/cancel/POST/index.js`)

**Authentication:**
- Extracts the user's `sub` from the JWT Bearer token via `getRequestClaimsFromEvent`.

**Validation:**
- Ownership: `booking.userId === sub`.
- Already-cancelled fast-fail: `booking.status === 'cancelled'` → 400.
- Cancellable state: `booking.status === 'confirmed'` (in-progress sessions are reaped by the scraper, not this endpoint).
- Pre-checkout: cancellation must occur before `booking.reservationContext.checkoutTime`.

**Request body (optional):**
```js
{ reason: "User-provided cancellation reason" }
```

### 3. Atomic cancellation write (`flagCancelledBooking`)

Builds a single DynamoDB UpdateItem:

```js
SET status = "cancelled",
    cancellationTime = <queryTime>,
    isPending = "PENDING"
    [, cancellationReason = <reason> if provided]
ConditionExpression: attribute_exists(pk)
                 AND userId = :userId
                 AND attribute_not_exists(cancellationTime)
```

The `ConditionExpression` enforces three invariants atomically:
- `attribute_exists(pk)` — the booking row must still exist (a concurrent delete cannot upsert a phantom cancelled tombstone).
- `userId = :userId` — ownership held at write time, not just at the read-time pre-check.
- `attribute_not_exists(cancellationTime)` — only the first racing cancel wins; the loser hits `ConditionalCheckFailed` and the handler returns a clean 400 "already cancelled" instead of sending a duplicate email.

> **Invariant**: nothing else in the codebase should set `cancellationTime`. It is the single marker `flagCancelledBooking` uses to detect duplicate cancellations.

### 4. Cancellation email

After the write succeeds the handler calls `sendBookingCancellationEmail(emailParams, sub)`:

- Looks the user up via Cognito `ListUsers` filter on the immutable `sub` (not username/email).
- Verifies `email_verified = true` — skips and logs at ERROR if not, so monitoring catches the anomaly.
- Hands a `cancellation_bcparks_*` template payload to the email-dispatch SQS queue.

Email failures are caught and logged but do **not** roll back the cancellation.

### 5. Inventory return (deferred to the scraper)

The handler sets `isPending = "PENDING"` but does not return inventory inline. The scheduled `ExpiredBookingCleanupFn` (`incompleteBookingScraper`) picks the booking up on its next run and atomically:

1. Adds the booking's inventory back to each affected `inventoryPool`.
2. `REMOVE isPending` on the booking once inventory is settled.

This is the path that closes the inventory loop today. When the refund pipeline lands, the cancel POST will additionally publish to the refund topic (or its successor) — until then, refunds are stubbed.

### Response

```js
{
  message: "Booking cancelled",
  bookingId
}
```

---

## Transaction Refund Workflow

> Status: scaffolding only. The cancel POST does **not** currently publish a refund request — payment + Worldline integration is pending. The pieces below describe the intended end state.

### 1. Refund Request Publication

Refund requests will originate from:
- Booking cancellation (published by the cancel POST handler once payments are wired up)
- Direct refund API calls (future: admin-initiated refunds)

**Refund Message Structure:**
```js
{
  clientTransactionId: "BCPR-abc123",
  bookingId: "booking-123",
  user: "user-sub-id",
  refundAmount: 50.00,
  reason: "Cancellation by user via self-serve"
}
```

### 2. Refund Subscriber (`transactions/refunds/subscriber/index.js`)

**Triggered by:** SNS `refund-requests` topic

**Phase 1: Validation & Ownership**

1. **Parse SNS Message**: Extracts `clientTransactionId`, `user`, `refundAmount`, `reason`
2. **Verify Transaction Ownership**: Calls `findAndVerifyTransactionOwnership()`
   - Validates user owns the transaction
   - Returns 401 if unauthorized
   - Returns 403 for anonymous transactions (should require a one-time verification token / confirmation sent to the user's email address)
   - Supports admin override (when implemented)

**Phase 2: Transaction Status Checks**

3. **Check Eligibility**:
   - ✅ **Allowed**: `paid`, `partial refund` status
   - ❌ **Rejected**: `refunded` (returns 409 Conflict)
   - ❌ **Rejected**: `in progress`, `cancelled` (returns 400 with current status)

**Phase 3: Idempotency & Duplicate Detection**

4. **Create and Check Refund Hash** (`createAndCheckRefundHash()`):

This function prevents duplicate refunds using a **3-minute time window**:

```js
async function createAndCheckRefundHash(user, clientTransactionId, trnAmount, windowMinutes = 3)
```

**How it works:**
- Queries all existing sk `refund::*` records for the transaction from DynamoDB
- Calculates `windowStart` = current time minus 3 minutes
- Checks for duplicates:
  - **Duplicate if**: Same amount + within time window + status is `refund in progress` or `refunded`
  - **Allowed if**: Same amount but OUTSIDE time window (legitimate multiple refunds)
  - **Allowed if**: Different amount within time window (partial refunds in quick succession)
- Generates unique hash: `SHA256(user::transactionId::amount::sequence::timestamp)`
- Stores hash record in DynamoDB with metadata

**Returns:**
```js
{
  refundHash: "abc123...",
  refundSequence: 2,              // Current refund number
  totalRefunded: 30.00,           // Amount refunded before this
  totalAfterRefund: 80.00         // Amount refunded including this
}
```

**Duplicate Detection Logic:**
- ✅ **$30 refund 5 minutes ago** → New $30 refund = **ALLOWED** (outside window)
- ❌ **$30 refund 1 minute ago** → New $30 refund = **REJECTED 409** (within window)
- ✅ **$20 refund 1 minute ago** → New $50 refund = **ALLOWED** (different amount)

5. **Validate Refund Amount**: Ensures `totalAfterRefund` doesn't exceed original transaction amount

**Phase 4: Create Refund Record**

6. **Create Refund** (`createRefund()`):

Generates Worldline refund transaction:

```js
const params = new URLSearchParams({
  requestType: "BACKEND",
  merchant_id: MERCHANT_ID,
  trnType: "R",                           // Refund type
  adjId: transaction.trnId,               // Original Worldline transaction ID
  trnAmount: refundAmount,
  trnOrderNumber: refundTransactionId,    // New refund ID (RFND-xxxxx)
});
```

Creates refund record in DynamoDB:
```js
{
  pk: `transaction::${clientTransactionId}`,
  sk: `refund::${refundTransactionId}`,
  amount: refundAmount,
  bookingId: bookingId,
  globalId: refundTransactionId,
  originalTransactionId: clientTransactionId,
  refundReason: reason,
  refundSequence: 1,
  schema: "refund",
  transactionStatus: "refund in progress",
  transactionUrl: refundUrl,
  user: user
}
```

7. **Update Original Transaction**: Tracks refund amounts and updates status:
```js
{
  transactionStatus: "refund in progress",  // or "partial refund"
  refundAmounts: [{ "RFND-xyz": 50.00 }]   // Array of refund entries
}
```

**Phase 5: Queue for Worldline Processing**

8. **Send to SQS**: Queues refund request for Worldline API submission:

```js
const sqsMessage = {
  refundTransactionId: "RFND-xyz",
  originalTransactionId: "BCPR-abc123",
  worldlineTransactionId: transaction.trnId,
  refundAmount: 50.00,
  bookingId: "booking-123",
  pendingTransactionStatus: "refunded"  // or "partial refund"
};
```

Sent to `worldline-request-queue` with visibility timeout of 90 seconds.

**Error Handling:**
- If SQS queueing fails, marks refund as `failed` in DynamoDB
- Returns 500 with error details

**Success Response:**
```js
{
  statusCode: 200,
  body: {
    message: "Refunds processed",
    results: [{
      refundId: "RFND-xyz",
      transactionStatus: "queued_for_processing",
      bookingId: "booking-123"
    }]
  }
}
```

### 3. Worldline Processor (`transactions/refunds/processor/index.js`)

**Triggered by:** SQS `worldline-request-queue` event source

**Processing:**

1. **Poll SQS Queue**: Lambda polls with batch size of 1 (processes one refund at a time)
2. **Submit to Worldline**: Makes HTTP POST request to Worldline refund API
3. **Update Status**: Updates refund record based on Worldline response
   - Success: `transactionStatus = "refunded"`
   - Failure: `transactionStatus = "failed"`, stores error details

**Concurrency:** Limited to 5 concurrent executions to respect Worldline rate limits

**Dead Letter Queue:** Failed messages (after 3 retries) sent to `worldline-request-queue-dlq` with 14-day retention

---

## Local Development

### GoAWS Configuration (`goaws.yaml`)

For local testing of the refund pipeline (cancellations are now synchronous and do not go through SNS/SQS), GoAWS simulates SNS/SQS:

```yaml
Queues:
  - Name: refund-request-queue
  - Name: worldline-request-queue

Topics:
  - Name: refund-requests
    Subscriptions:
      - QueueName: refund-request-queue
```

**Local endpoints:**
- Queue URL: `http://localhost:4100/queue/{queue-name}`
- Topic ARN: `arn:aws:sns:us-east-1:000000000000:{topic-name}`

### Running GoAWS with Docker

[GoAWS](https://github.com/Admiral-Piett/goaws) is a local AWS SNS/SQS emulator that allows you to test the booking workflow without connecting to actual AWS services.

**Start GoAWS:**
```bash
docker run -d \
  --name goaws \
  -p 4100:4100 \
  -v "$(pwd)/goaws.yaml:/conf/goaws.yaml" \
  admiralpiett/goaws
```

**Verify it's running:**
```bash
# Check container status
docker ps | grep goaws

# View logs
docker logs -f goaws
```

**Stop/restart:**
```bash
docker stop goaws
docker start goaws
docker rm goaws  # Remove container
```

GoAWS will:
- Create the SNS topics and SQS queues defined in `goaws.yaml`
- Accept published messages to topics
- Route messages to subscribed queues
- Store messages in memory for Lambda polling

**Access the Web UI:** http://localhost:4100/ (shows topics, queues, and messages)

### Local Testing Workflow

The local testing tool simulates the refund pipeline on your machine. The cancellation step itself now runs synchronously in the cancel POST handler — exercise that by calling the API directly.

**Run the poller:**
```bash
yarn booking-workflow:poller
```

**What it does:**
1. Polls the local SQS queues (`refund-request-queue`, `worldline-request-queue`)
2. Receives messages from GoAWS
3. Invokes the Lambda handler functions directly (bypass AWS Lambda)
4. Processes refunds end-to-end
5. Logs detailed execution information to console

**Typical workflow:**
1. Start GoAWS container
2. Run the poller in one terminal: `yarn booking-workflow:poller`
3. Trigger a cancellation via API: `POST /bookings/{bookingId}/cancel`
   - The cancel POST writes the cancellation directly to DynamoDB (no SNS hop).
   - Once refunds are wired up, the cancel POST will also publish to `refund-requests`.
4. Watch the console as the poller:
   - Picks up the refund message from `refund-request-queue`
   - Creates refund record and queues Worldline request
   - Processes the Worldline request from `worldline-request-queue`

**Environment variables needed:**
```bash
TRANSACTIONAL_DATA_TABLE_NAME=your-local-dynamo-table
MERCHANT_ID=your-worldline-merchant-id
HASH_KEY=your-worldline-hash-key
```

**Debugging tips:**
- Check GoAWS web UI (http://localhost:4100/) to see queued messages
- View `goaws_messages.log` for message routing details
- Add breakpoints in handler code for step-by-step debugging
- Use `LOG_LEVEL=debug` for verbose logging

---

## Error Handling & Observability

**Status Codes:**
- `200` - Success
- `400` - Invalid request (missing params, ineligible transaction)
- `401` - Missing or invalid authentication
- `403` - Forbidden (not authorized, anonymous user requires verification)
- `404` - Transaction/booking not found
- `409` - Conflict (already refunded, duplicate within time window)
- `500` - Internal error (DynamoDB, SQS failure)

**CloudWatch Metrics:**
- Lambda invocation counts and errors
- SQS queue depth and age of oldest message
- DLQ message counts (alert threshold recommended)

**Retention Policies:**
- DLQ messages: 14 days
- SQS standard messages: 4 days
- Refund hash records: Permanent (for audit trail)

---
