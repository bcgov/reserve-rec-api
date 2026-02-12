# Policy Primitives
Policy primitives are the fundamental building blocks used to define all reservation governance in the system. While the system exposes high-level [policy types](#policy-types), each of these types is ultimately composed from a shared set of primitives. These primitives provide consistent vocabulary for expressing rules, ensure predictable, deterministic behaviour across products, and make the policy layer extensible as new reservation models are introduced.

Understanding these primitives is essential for understanding how policies work, how overrides behave, and how ProductDates are generated.

All policies are composed from these primitives:
- [Temporal Window Primitive](#temporal-window-primitive) — define when an action is allowed
- [Temporal Anchor Primitive](#temporal-anchor-primitive) — define what point in time rules are relative to
- [Temporal Duration Primitive](#temporal-duration-primitive) — define how long something must or may last
- [Interval Primitive](#interval-primitive) — define groups of dates that behave as a unit
- [Arithmetic Primitive](#arithmetic-primitive) — A linear arithmetic expression that determines numerical results, evaluated left-to-right
- [Comparison Primitive)(#comparison-primitive) - Compares two arithmetic primitives using a comparison operator
- [Eligibility Primitive](#eligibility-primitive) — Uses comparison primitives to chain boolean results and drive if/then logic
- [Reference Primitive](#reference-primitive) - a named, pre-computed or derived value that is evaluated once and stored in booking context so other primitives can reference it

Each primitive is small and self‑contained, but together they can express the full complexity of reservation governance.

## Temporal Anchor Primitive

The date or timestamp that temporal calculations can use as reference points.

Examples:
- Arrival Date
- Departure Date
- Reservation Date
- Fixed calendar datetimes (e.g., “Jan 17 at 08:00”)

Anchors should resolve to either a calendar date (YYYY-MM-DD) or a single ISO 8601 timestamp (when supplied a time-of-day offset and  combined with the appropriate timezone). They ensure that booking windows, change windows, and fee calculations behave consistently—even across daylight savings transitions.

### Evaluation procedure
1. Resolve the initial calendar date

The anchor begins by looking at the `anchorRef` property. This must reference a temporal anchor from the `refStore`. The `anchorRef` resolves to a calendar date. If the reference is a timestamp, the calendar date is chopped from the timestamp:

> `2026-01-27T14:58:03-08:00` becomes 2026-01-27

If `anchorRef` cannot be resolved because the value in `refStore` does not exist, the resolution is skipped (see [reference primitive dependency loops](#reference-primitive).

If there are no other fields in the anchor, the anchor is resolved as a calendar date and stored.

2. Apply the duration in the temporal direction

If the anchor contains a `duration` and a `direction`, apply the duration to the `initialDate` in the temporal direction of `direction`. The result is a calendar date.

If there is no `timeOfDay` field in the anchor, the anchor is resolved as calendar date and stored.

3. Apply time of day offset

If the anchor contains a `timeOfDay` field, apply the time of day offset to the running calculated date (this may be from step 1, or step 2 if there was a duration applied).The result is an ISO 8601 timestamp, with the timezone set to whatever the policy's `timezone` is.

The anchor is resolved as an ISO 8601 timestamp and stored.

The order of operations is important when calculating temporal windows, so as to make the result deterministic.

This order is crucial to avoid temporal nondeterminism:
- Applying time-of-day calculation before duration math can cause the result to shift by 1 hour over daylight savings transitions.
- Performing duration math in UTC may not respect daylight savings transitions in certain timezones.
- All calculations must occur in the same timezone.

### Temporal Anchor
Property|Type|Description  
-- | -- |  --
`anchorRef`| String| The id of the reference point used for time calculations. Determines how windows and durations are interpreted.| 
`useAnchorTime`|Boolean|If true, chop `anchorRef` time of day before evaluation, and reapply after. Defaults to '00:00:00'|
`duration`|TemporalDuration|The duration to apply to the `initialDate` to get `initialDateTime`|
`timeOfDay`|Time| Time-of-day offset applied to the calendar date to get a  timestamp. Overrides `useAnchorTime`|

### Time
```js
TimeOfDay = {
  "hour": number,      // hour of day (0-23)
  "minute?:" number,   // minute of hour (0-59)
  "second?:" number    // second of minute (0-59)
}
```


```js
// Below are some possible ReferencePrimitive points for `anchorRrf`.
TemporalAnchorEnum: {
   "anchors.arrivalDate",         // The date of visitor arrival
   "anchors.departureDate",       // The date of visitor departure
   "anchors.reservationDate",     // The date the reservation is made
   "anchors.rangeStart",          // Product's `rangeStart` value
   "anchors.rangeEnd",            // Product's `rangeEnd` value
}
```

Example:
```json
"temporalAnchor": {
   "anchorRef": 'arrivalDate',
   "timeOfDay": {
      "hour": 7
   }
}
```

## Temporal Duration Primitive

The length of time of an event.

Examples:
- Minimum/maximum stay length
- Length of a rolling reservation window (4 months in advance, two days in advance)
- Minimum notice before arrival
- Penalty windows (“changes within 48 hours incur a fee”)

Duration rules allow the system to express constraints that depend on how long something lasts, not just when it occurs.

Schema
```js
TemporalDuration {
  direction: string  // "before | after"
  // At least one field must be present.
  years?: number;    // integer ≥ 0
  months?: number;   // integer ≥ 0
  weeks?: number;    // integer ≥ 0
  days?: number;     // integer ≥ 0
  hours?: number;    // integer ≥ 0
  minutes?: number;  // integer ≥ 0
  seconds?: number;  // integer ≥ 0
}
```
- All fields are optional, but at least one must be provided (`direction` exempt).
- All values must be non‑negative integers.
- Durations are not normalized (e.g., { months: 4 } stays as 4 months, not 120 days).

Example:
```json
"temporalDuration": {
  "months": 4
}
```
## Temporal Window Primitive

When an action is allowed or disallowed. They are typically comprised of a pair of temporal anchor primitives, one for 'open', the other for 'close'.

Examples:
- When reservations open and close
- When changes/cancellations are permitted
- When peak pricing or discounts apply

Window rules give the system deterministic control over time‑bounded actions.

```js
TemporalWindow {
  id: String                 // Identifier
  label: String              // Human-readable label
  open: TemporalAnchor;      // opening time boundary
  close: TemporalAnchor;     // closing time boundary
}
```

Example: This TemporalWindow describes a time block from 7am on the day four months before the arrival date, to 11:59pm on the arrival date itself.
```json
"temporalWindow": [
  "id": "discoverabilityWindow",
  "label": "Discoverability Window",
  "open": {
    "anchorRef": "arrivalDate",
    "duration": { "months": 4, "direction": "before" },
    "timeOfDay": { "hour": 7 }
  },
  "close": {
    "anchorRef": "arrivalDate",
    "timeOfDay": { "hour": 23, "minute": 59 }
  }
}
```


## Interval Primitive

Groups of dates that behave as a unit.

Examples:
- Holiday weekend minimum‑stay requirements

Intervals allow the system to express rules like “if you book any date in this block, you must book all days in the block.”

Note that similar rules like "minimum 3 nights stay" can be stored as `minStay` in a booking policy, and do not necessarily enforce the same intent. A `minStay` of 3 on long weekend nights does not force visitors to book specific days, only that their stay must be at least 3 days long.

Schema:
```js
Interval {
  label: string                // Label of the interval (identifying what it applies to)
  description: string          // Description of the interval (describing what it applies to)
  dates: LocalDate[];          // required — list of ISO dates (YYYY-MM-DD)
}
```
Example: Special event pricing applies only if the entire stay covers July 1–3.
```json
"interval": {
  "dates": [
    "2025-07-01",
    "2025-07-02",
    "2025-07-03"
  ],
  "requireAllDates": true,
  "blockActions": false
}
```

## Arithmetic Primitive

A linear sequence of numerical operands and operators evaluated left-to-right. They are structured as array with an odd number of indices. Each odd numbered index is an [operand](#operands) and each even-numbered index is an [operator](#operators). Starting from the first operand, each pair of following `[operator, operand]` is applied in order until the array has been traversed, resolving in a final number.

### Operand

An operand may be a constant numerical value, or a value taken from `evaluationContext` that resolves to a number, or a nested ArithmeticPrimitive expression that resolves to number.

| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
|`type`|String|`constant`, `field`, `expression`|
|`value`|Any|A constant numerical value, or the name of the field to resolve, or another ArithmeticPrimitive|

### Arithmetic Operator
```js
ArithmeticOperators = [
  add,                     // add
  sub,                     // subtract
  mul,                     // multiply
  div,                     // divide
]
```

```js
number = [ operand, operator, operand, operator, operand, ...]
```

## Comparison Primitive

A comparator that compares two arithmetic primitives. It is comprised of a left-hand-side operand, a comparison operator, and a right-hand-side operand. Evalutates to a boolean.

### Comparison
| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
|`lhs`|ArithmeticPrimitive|An arithmetic primitive|
|`op`|ComparisonOperator|A comparison operator|
|`rhs`|ArithmeticPrimitive|An arithmetic primitive|

### Comparison Operator
```js
comparisonOperators = [
 "eq",             // equal
 "neq",            // not equal
 "lt",             // less than
 "lte",            // less than or equal
 "gt",             // greater than
 "gte",            // greater than or equal
]
```

## Eligibility Primitive

A simple conditional structure comprised of comparison primitives. It contains an `if` statement and a `then` statement. Evaluates to a boolean.

Eligibility primitives support the following logical evaluation:

> if X is TRUE, then Y MUST also be TRUE, else the evaluation fails and the expression is FALSE.
> if X is FALSE, then the expression is never evaluated.

### Eligibility
| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
|`id`|String|Expression identifier|
|`label`|String|Human readable label of the expression|
|`failMsg`|String|A helpful message to display in the event the expression fails|
|`if`|[ComparisonPrimitive]|An array of comparison primitives|
|`then`|[ComparisonPrimitive]|An array of comparison primitives|

### If Statement

A logical statement comprised of an array of comparison primitives and chained by a logical AND. Every comparison primitive must evaluate to TRUE for the if statement to pass and the `then` statement to be evaluated. An empty array automatically evaluates to TRUE.

### Then Statement

A logical statement comprised of an array of comparison primitives and chained by a logical AND. Every comparison primitive must evaluate to TRUE for the then statement to pass and for the eligibility primitive to resolve to TRUE.

## Reference Primitive

A reference primitive is a lightweight lookup that retrieves the value of a previously defined fact from the evaluation context so other primitives can use it without recomputing anything.

### Reference
| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
|`id`|String|Reference identifier|
|`label`|String|Human readable label of the reference|
|`type`|String|Reference data type|
|`value`|Any|The value of the reference|

During booking evaluation, reference primitives are recorded in a lookup store called `refStore`. This way, they can be made available for other primitives, even across policies, so the whole booking maintains the same context.

The `refStore` is populated in the order that references are made available. Some are directly available at the beginning of a booking evaluation stage, others are derived/evaluated and available at the end of that stage. Each stage should have access to the references resolved in the preceding stages. The approximate ordering of stages follows:

1. User refs: information related to the user making the booking
2. Inventory: information related to the inventory the user has selected for the booking
3. Anchors: temporal anchors that are inherently defined by the inventory selected (`arrivalDate`, `departureDate`, etc)
4. Windows: temporal windows that are derived from the previously calculated anchors.
5. Dependency Loop: Some temporal anchors & windows are derived from others. This stage loops through unresolved windows and anchors and resolves dependent ones. The looping stops when all dependencies have been resolved, or nothing new is evaluated during the loop.
6. PartyCategories: Counts of people and equipment classes defined by the party policy and provided by the user when they declare their party breakdown
7. PartyGroups: Aggregates of party counts defined by the party policy
8. Fees: Fee schedule defined in the fee policy

### RefStore
| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
|`user`|[ReferencePrimitive]|Reference primitives related to the user making the booking|
|`inventory`|[ReferencePrimitive]|Reference primitives related to the booking inventory|
|`anchors`|[ReferencePrimitive]|Reference primitives that are temporal anchors (ISO 8601 timestamps)|
|`windows`|[ReferencePrimitive]|Reference primitives that are temporal windows (contain open and close ISO 8601 timestamps)|
|`partyCategories`|[ReferencePrimitive]|Reference primitives that are first-order party breakdown classes (people AND equipment)|
|`partyGroups`|[ReferencePrimitive]|Reference primitives that are second-order party aggregations (groups of `partyCategories`)|
|`fees`|[ReferencePrimitive]|Reference primitives that are fees|

# How Primitives Compose into Policy Schemas

Policy primitives are the foundational building blocks of the reservation governance model. Each primitive represents a small, focused concept—such as a time window, a duration constraint, or an eligibility requirement. Policy types (Booking, Change, Party, Fee) are not independent inventions; they are compositions of these primitives arranged to express the rules relevant to each domain.