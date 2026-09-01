# Load-test harness (k6) — end-to-end booking flow

k6 harness for [issue #469](https://github.com/bcgov/reserve-rec-api/issues/469): capacity,
peak, contention, abandonment, and cold-start testing of the public booking API through the
CloudFront front door.

```
loadtest/
├── README.md            this runbook
├── config.js            every knob, env-driven with defaults
├── scenarios.js         single k6 entry point (PROFILE-selected)
├── lib/api.js           one function per endpoint + response guards + counters
├── lib/data.js          token-pool loader (tokens.json)
├── scripts/mint-tokens.js  Cognito user/token pool minting + cleanup
└── tokens.json          generated, gitignored — contains live access tokens
```

This directory is deliberately outside the jest roots (`test/`, `src/` — see
`jest.config.js`), so nothing here runs under the unit-test suite.

---

## Prerequisites

### 1. A prod-like target environment

Results are only meaningful against an environment with production-fidelity settings:
Lambda memory/concurrency, DynamoDB capacity mode, OpenSearch instance class/count, and
CloudFront/WAF configuration must match prod, otherwise the numbers say nothing about
launch readiness. The test environment (`https://test-reserve.bcparks.ca`) is the intended
target; confirm its settings against prod before drawing conclusions.

**Always target the front door, never API Gateway directly.** The default
`BASE_URL` is `https://test-reserve.bcparks.ca/dayuse/api`. The CloudFront distribution
injects an `X-Origin-Verify` header that an origin WAF rule requires — direct API Gateway
requests are dropped — and the CloudFront hop (including the path-strip function) is part
of the user-visible latency being measured.

### 2. Egress: validate rate limiting before the run

A load generator concentrates traffic that real users spread across thousands of
source IPs, so any per-IP rate limit sees the generator as one aggressive client.
Before a run, **validate what rate limiting actually exists**: check the WAF console
for rate-based rules on the front-door distribution and the API stage (none are
defined in either repo's CDK — anything present is console-managed). If a rate rule
exists, exempt the generator's source IPs for the run (or temporarily raise the
rule) and remove the exemption afterwards — exemption is crowd-realistic, since no
individual real user trips a per-IP rule. If none exists, no action is needed.

Two per-IP limits that ARE in code regardless: the waiting-room join guard caps
queue entries at 4 per source IP (`MAX_ENTRIES_PER_IP`) — relevant only with
`WAITING_ROOM=true`, where you need distinct generator IPs ≥ admitted-VUs ÷ 4 or a
raised env value — and generator-side socket/ephemeral-port exhaustion, which is
what §3's distributed generators solve (`--execution-segment "i:N"` per machine
splits any profile cleanly across IPs).

### 3. k6

Install k6 from your package manager or https://k6.io/docs/get-started/installation/.
Any k6 ≥ 0.46 works. For the full 14k-VU search burst you will likely need distributed generators
(`k6-operator`, or several machines with `BURST_VUS` split between them) — a single
box runs out of sockets/CPU first.

### 4. Seeded data

The scenarios book against seeded reference data. Seed with:

```sh
# defaults target LOCAL DynamoDB (http://localhost:8000) — override both envs for AWS:
TABLE_NAME=<env reference data table> \
DYNAMODB_ENDPOINT_URL=https://dynamodb.ca-central-1.amazonaws.com \
node src/scripts/tools/dynamodb/seed-collection.js
```

The seed creates collection `bcparks_7` whose activities are all type `dayuse`
(activity ids 1–3 per park area, e.g. `dayuse/1` = Cheakamus Day-use Pass with product
id 1); every seeded product is `activitySubType: vehicleParking`, so booking quantity is
hard-capped at **1** — the harness defaults `QUANTITY=1` accordingly. The default target
ids are `bcparks_7 / dayuse / 1 / 1`; override with `COLLECTION_ID` / `ACTIVITY_TYPE` /
`ACTIVITY_ID` / `PRODUCT_ID`.

Pick a `BOOKING_DATE` (default: tomorrow, UTC) whose productDate has
`reservationContext.isReservable === true` and an open reservation window — verify with:

```sh
curl -s "https://test-reserve.bcparks.ca/dayuse/api/product-dates/bcparks_7/dayuse/1/1?date=2026-08-29" | jq '.data'
```

### 5. Token pool (mint day-of)

`POST /bookings`, `/complete`, `/cancel` require a Cognito **access** token (ID tokens
401 — the custom authorizer allows everything through and the handler checks claims).
The public user-pool client only enables the SRP flow, so tokens are pre-minted rather
than fetched inside k6:

```sh
# ambient AWS creds for the dev/test account (623829546818)
USER_POOL_ID=<public user pool id> CLIENT_ID=<public app client id> \
COUNT=300 PASSWORD='<strong password>' \
node loadtest/scripts/mint-tokens.js
```

This AdminCreateUser-s (MessageAction SUPPRESS) + AdminSetUserPassword-s N permanent
users, SRP-authenticates each, and writes `loadtest/tokens.json`
(`[{username, sub, accessToken}]` — gitignored, contains live credentials).

- **Access tokens live 24h** (`accessTokenValidity: 1 day` on the client) — mint the
  same day as the run.
- Each concurrent **booking** needs its **own** user (see "Duplicate-booking
  constraint" below). Token assignment is scenario-dense, so the 14k unauthenticated
  search-burst VUs in `capacity` don't consume users — only the booking scenario's max
  VUs matter. `scenarios.js` fails fast in `setup()` if `tokens.json` has fewer users
  than that. Mint at least `RAMP_MAX_VUS` (default 300) for `capacity`.
- Default emails are `success+loadtest<n>@simulator.amazonses.com` (SES mailbox
  simulator) because completes/cancels trigger real SES email sends — simulator
  addresses can't bounce against the account's sender reputation. Override with
  `EMAIL_PATTERN='loadtest+{n}@yourdomain.example'` if you need a different shape.
- Cleanup: `USER_POOL_ID=... node loadtest/scripts/mint-tokens.js --cleanup`.

---

## Running

All commands from the repo root. `PROFILE` selects the scenario set:

```sh
# Scenario 1 + 2 together (the default): gated booking ramp measured while an
# ungated search burst saturates the read path.
k6 run -e PROFILE=capacity loadtest/scenarios.js

# Rehearsal-sized capacity run:
k6 run -e PROFILE=capacity -e BURST_VUS=200 -e RAMP_STEPS=5,10 -e STEP_HOLD=2m loadtest/scenarios.js

# Scenario 3 — realistic peak (browse ratio + repeat searches + abandonment):
k6 run -e PROFILE=peak loadtest/scenarios.js

# Scenario 4 — oversell-guard contention (set SEED_INVENTORY to the real capacity!):
k6 run -e PROFILE=contention -e CONTENTION_VUS=50 -e SEED_INVENTORY=25 loadtest/scenarios.js

# Scenario 5 — abandonment / hold-release soak (must run > 15 min):
k6 run -e PROFILE=abandonment -e ABANDON_DURATION=25m loadtest/scenarios.js

# Scenario 6 — cold start (see procedure below):
k6 run -e PROFILE=coldstart loadtest/scenarios.js
```

Useful extras: `--out json=results.json` or `--out experimental-prometheus-rw` for
retention; `--summary-export summary.json` for the threshold verdicts.

### The six scenarios

| # | Scenario | Profile | Shape |
|---|----------|---------|-------|
| 1 | `gated_ramp` | `capacity` | ramping-arrival-rate through `RAMP_STEPS` bookings/min (default 10,25,50,100), full chain, each step held `STEP_HOLD`; every request tagged `step:<rate>per_min` |
| 2 | `ungated_search_burst` | `capacity` | ramping-vus to `BURST_VUS` (default 14000) doing search-only; runs **concurrently** with scenario 1 |
| 3 | `realistic_peak` | `peak` | arrival rate to `PEAK_RATE`/min; `BROWSE_RATIO` (0.7) of arrivals only browse (1–3 searches + dates); bookers abandon at `ABANDON_RATIO` (0.4) |
| 4 | `contention` | `contention` | `CONTENTION_VUS` users each fire one booking at the SAME product/date; counts guard rejections vs successes |
| 5 | `abandonment` | `abandonment` | constant arrivals; `ABANDON_RATIO` of successful holds are left to expire; verifies released inventory is rebookable |
| 6 | `cold_start` | `coldstart` | sharp constant-arrival step from zero after `COLD_GATE` |

### How the two concurrent profiles work (scenario 1 + 2)

`PROFILE=capacity` enables **both** `gated_ramp` and `ungated_search_burst` in one k6
run. k6 scenarios execute independently and concurrently: the search burst holds a large
flat VU count against `/search` (the ungated read path — OpenSearch, no auth) while the
booking ramp steps arrival rate through the full authenticated write chain. This answers
the ticket's core question: does the gated booking flow hold its SLO while the read side
is saturated? Per-endpoint tags plus the `step` tag let you report "last step within SLO":
filter `http_req_duration{endpoint:bookings,step:50per_min}` etc. in your output store, or
run with `--out json` and post-process.

### Scenario 4 — checking the oversell assertion

Successes are counted in the `bookings_succeeded` counter; rejections split into
`inventory_conditional_check_failed` (ConditionalCheckFailed — sold out) and
`inventory_transaction_conflict` (TransactionConflict — concurrent writers, retryable).
Set `SEED_INVENTORY` to the target productDate's real seeded capacity (read it from the
`product-dates` response before the run) and the harness adds a
`bookings_succeeded: count<=SEED_INVENTORY` threshold — the run FAILS if the guard ever
oversells. Cross-check in DynamoDB afterwards: the number of `booking::...` items in
`in progress`/`confirmed` for that product/date must be ≤ capacity. Contention iterations
deliberately never cancel, so **reset the product afterwards** (see Teardown).

### Scenario 5 — what "verified" means

Holds expire after **15 minutes** (`DEFAULT_SESSION_LENGTH`,
`src/handlers/bookings/methods.js:34`; overridable per-product via
`product.holdDuration.minutes`), after which the expired-booking scraper releases the
inventory. A VU that abandons leaves its hold in place (no cancel) and is 409-blocked
from rebooking until release — so a fresh success by that VU (counted in
`rebook_after_release`) proves the release actually happened. **A run shorter than the
hold window can't observe any releases**: soak for at least `ABANDON_DURATION=20m`,
ideally 25–30m, and expect `rebook_after_release > 0`.

### Scenario 6 — cold-start procedure

The measurement is only valid against **cold** Lambdas:

1. No traffic to the environment for ≥ 15–30 min beforehand (idle gate) — no smoke
   tests, no warmers/provisioned concurrency, no synthetic canaries.
2. Confirm in CloudWatch there were no recent invocations of the search/productDates/
   bookings functions.
3. Start the run at the simulated "scheduled opening" instant:
   `k6 run -e PROFILE=coldstart loadtest/scenarios.js`. `COLD_GATE` can add an in-run
   idle offset if you prefer to start k6 early.
4. Read cold-start cost from CloudWatch `Init Duration` (report/log insights) and the
   p95/p99 of the first minute vs steady state.

---

## SLO thresholds

Defaults (from the ticket): **p95 < 3000 ms** per endpoint and overall, **error rate
< 0.5%**. Change with `-e P95_MS=2000 -e MAX_ERROR_RATE=0.01`. They are emitted as k6
`thresholds` in `config.js` (`buildThresholds()`): a breached threshold makes k6 exit
non-zero, per-endpoint variants use the `endpoint:` request tags
(`http_req_duration{endpoint:search}` etc.).

Expected-outcome statuses are excluded from `http_req_failed` via per-request
`responseCallback`s: 409 on `POST /bookings` (duplicate guard — handled by the chain),
400 additionally under `contention` (the rejection being measured), 400 on `cancel`
(raced the expiry reaper), 403 on `claim`. Everything else counts as an error.

### Checkout duration vs the TTLs (admission window AC)

The chain records a `checkout_duration` Trend: elapsed ms from the successful
`POST /bookings` response to the successful `/complete` response. Add realistic
form-filling time with `-e CHECKOUT_THINK_S=120` (seconds of sleep between booking and
complete, default 0) — remember arrival-rate executors then need proportionally more
VUs (`*_MAX_VUS` ≥ rate × iteration duration).

Interpret against two server-side windows:

- **Waiting-room admission TTL**: `ADMISSION_TTL_MINUTES`, default **15 min**
  (`src/handlers/waiting-room/claim/handler.js:8`).
- **Booking hold / session expiry**: `product.holdDuration.minutes`, falling back to
  `DEFAULT_SESSION_LENGTH` = **15 min** (`src/handlers/bookings/methods.js:34`, applied
  at `:744`); `/complete` 403s once `sessionExpiry` passes.

**Verdict rule**: the run's `checkout_duration` **max and p99** (both printed in the
summary) must stay comfortably below *both* TTLs — worst-case checkout under load fits
inside the admission window and the hold window. If p99 approaches either 15-minute
mark under load (slow completes, retries, think time), the TTLs are too tight for real
users and the AC fails.

A `html_masquerade_responses: count==0` threshold backs the SPA-HTML guard: the
standalone public distribution rewrites 403/404 → 200 `index.html`, so a misconfigured
target yields "passing" runs that never hit the API. Every response is content-type/body
sniffed (`lib/api.js`); any HTML response fails a check, increments the counter, and
fails the run.

### Recording results

Write measured capacity numbers, breaking points and bottleneck analysis up
**internally** (Confluence / the ticket), not in this repo. The repo is public: the
harness itself only restates what the public handler code already shows, but a
committed results document would hand out the system's measured limits — exactly the
aggregation an abuse actor wants and the one thing not already derivable from source.

---

## Duplicate-booking constraint

The API 409s a second booking for the same `(user, product, startDate)` while one is
`in progress` or `confirmed` (returning `data.existingBookingId`). The harness handles
this by:

1. **One user per concurrent booking** — k6 has no per-scenario VU id (`idInTest` is
   global, so under `capacity` the search-burst VUs would scatter the booking VUs' ids
   and collide users mod pool size). Single-scenario profiles therefore use the dense
   `idInTest` as a sticky per-VU token; `gated_ramp` maps by the scenario-unique
   sequential iteration counter (`exec.scenario.iterationInTest`), which keeps all
   concurrent iterations on distinct users as long as the pool ≥ `RAMP_MAX_VUS` —
   which `setup()` enforces.
2. **Cancelling between iterations** — the chain cancels its booking at iteration end
   (both completed and simulated-abandon paths), resetting the guard and keeping seeded
   inventory from draining during long ramps.
3. **Self-healing on 409** — a stale hold from a crashed prior iteration is cancelled via
   `existingBookingId` and the iteration ends.

The `abandonment` profile deliberately breaks rule 2 (holds must expire naturally) and
treats interim 409s as expected. The `contention` profile never cancels (successes must
stay held for the oversell count).

---

## Payment is out of scope

Payment (Worldline) is **disabled product-wide**: the booking flow ends at
`POST /bookings/{id}/complete`, which is exactly where the measured chain
(**search → product-dates → POST /bookings → POST /bookings/{id}/complete**) ends.
Extend the harness with the payment leg only when payment enablement lands.

## Waiting room

Enforcement on `POST /bookings` only fires when a queue META row exists for the target
product/date and isn't closed; **the default state (no rows) fails open**, so the harness
skips the queue entirely by default. To load-test with an active queue: create it via the
admin API, then run with `-e WAITING_ROOM=true` — each VU joins
(`POST /waiting-room/join`), polls until admitted, claims (`POST /waiting-room/claim`),
and the per-VU cookie jar carries the HttpOnly `bcparks-admission` cookie onto the
booking call. Joins are capped at 4 entries per source IP, so a meaningful queue test
needs many generator IPs.

---

## Teardown / reset

- **Bookings**: the chain cancels its own bookings; `contention` and `abandonment` leave
  residue by design. `POST /bookings/{bookingId}/cancel` (any leftover `in progress`
  hold also self-expires after 15 min and is reaped). For bulk cleanup use the existing
  DynamoDB tooling under `src/scripts/tools/dynamodb/` against the bookings table
  (bookings live under `pk = booking::<collectionId>::<activityType>::<activityId>::<productId>`,
  `sk = <startDate>::<bookingId>`), and note cancels fire real SNS refund + SES email
  flows — another reason the token emails default to the SES simulator.
- **Inventory**: re-run `seed-collection.js` to restore counts if a scenario drained
  them.
- **Users**: `node loadtest/scripts/mint-tokens.js --cleanup` deletes the minted pool
  and removes `tokens.json`.
- **WAF**: remove the generator-IP allowlist.

---

## CloudWatch instrumentation during runs

k6 gives the client view; capture the server view in CloudWatch for each run window and
map it to the ticket's acceptance criteria:

| Signal | Where | AC it evidences |
|---|---|---|
| Per-endpoint p50/p95/p99 latency | API Gateway `Latency`/`IntegrationLatency` per resource; CloudFront `OriginLatency` | SLO per step — corroborates k6's `endpoint:`/`step:`-tagged percentiles |
| Lambda throttles, concurrent executions, `Init Duration` | Lambda metrics + report logs (Logs Insights `filter @type="REPORT"`) | capacity ceiling; cold-start cost (scenario 6) |
| DynamoDB throttles + `TransactWriteItems` conditional failures | DynamoDB `ThrottledRequests`, `SystemErrors`; conditional rejections surface in the API 400s the harness counts (`inventory_conditional_check_failed` / `inventory_transaction_conflict`) | oversell guard behaviour under contention (scenario 4) |
| OpenSearch CPU, JVM memory pressure, indexing/search latency + queue/index lag | ES/OpenSearch domain metrics | search burst headroom (scenario 2) |
| API Gateway 4xx/5xx rates | APIGW `4XXError`/`5XXError` per stage | error-rate SLO (<0.5%) |
| CloudFront per-behaviour requests, error rate, cache stats | CloudFront distribution metrics | front-door fidelity; confirms the strip-function hop is in path |
| SES send/bounce, SNS publish rates | SES/SNS metrics | downstream side-effects of completes/cancels don't throttle the chain |

Snapshot dashboards before/after each step of the ramp so "last step within SLO" is
stated from both the k6 `step` tag and the server metrics.

---

## Validating changes to the harness

- Node scripts: `node --check loadtest/scripts/mint-tokens.js`
- k6 files are ESM; syntax-check with
  `node --input-type=module --check < loadtest/scenarios.js` (same for `config.js`,
  `lib/*.js`)
- Structural validation without a target: `k6 archive -e PROFILE=capacity loadtest/scenarios.js -O /dev/null`
  (runs the full init stage; repeat per profile).
- Smoke run (needs `loadtest/tokens.json` with ≥ 2 users; do NOT pass `--vus`/
  `--iterations` — they replace the scenarios config and k6 errors on the missing
  `default` function):

  ```sh
  k6 run -e PROFILE=coldstart -e COLD_RATE=6 -e COLD_DURATION=15s \
    -e COLD_PREALLOC_VUS=2 -e COLD_MAX_VUS=2 loadtest/scenarios.js
  ```

  ~15 s, a handful of full-chain iterations. Against the real front door it should
  pass all thresholds; against a dummy `BASE_URL` it completes with failed
  request checks/thresholds (which proves the harness itself runs).
