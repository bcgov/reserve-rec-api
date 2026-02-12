# ProductDate

A ProductDate represents a specific offering of a Product on a particular date. Each ProductDate is associated with a single Product, and inherits properties from the parent Product while also allowing for overrides at the ProductDate level. This allows for flexible management of offerings that may have different availability, reservation policies, booking policies, fee policies, or change policies on different dates.

## ProductDates as System Governance Modules

ProductDates are where the system enforces time-dependent rules and policies that govern how users can interact with offerings on specific dates. For each date that a Product is offered, the corresponding ProductDate captures specifically how that offering will behave on that date. This includes:

- When the specific date of the offering is discoverable to users
- When the specific date of the offering can be reserved by users
- If the date is the user's arrival date, when they can check in
- If the date is the user's departure date, when they can check out
- If the date is the user's arrival date, when the cutoffs for making or changing/cancellations to reservations are
- If the date is the user's arrival date, when the cutoff before no-shows is
- When the specific date of the offering incurs a booking restriction and changes are permanently disallowed
- The estimated availability for booking on that date
- The specific assets allocated for that date

# Properties

## ProductDate

| property|type|description|derived from|evaluated when|
|---|---|---|---|---|
| `pk`|String|Partition key|productDate::`collectionId`::`activityType`::`activityId`::`productId`|Searching for all ProductDates related to a specific Product.|
| `sk`|String|Sort key| `date`|Searching for a specific ProductDate related to a specific Product (disambiguated by date)|
|`gsipk`|String|Global secondary index partition key|Reserved|Reserved|
|`gsisk`|String|Global secondary index sort key|Reserved|Reserved|
| `schema`|String|Data type/Schema| "productDate" |Identifying that this item is a "productDate"|
| `globalId`| String|Globally unique UUID|Automatically generating on ProductDate POST| Searching for this specific item using the `globalId` GSI
|`collectionId`|String|The identifier of the collection this ProductDate belongs to|Parent Product's `collectionId`|Determining which collection this ProductDate belongs to|
|`activityType`|String|The identifier of the activity type this ProductDate belongs to|Parent Product's `activityType`|Determining which activity type this ProductDate belongs to|
|`activityId`|String|The identifier of the activity this ProductDate belongs to|Parent Product's `activityId`|Determining which activity this ProductDate belongs to|
|`productId`|Number|The unique identifier of the parent Product|Parent Product's `productId`|Determining which specific Product within the `collectionId` that this ProductDate refers to|
| `date`|Date|Calendar date uniquely identifying this ProductDate from other ProductDates with the same partition key|Automatically generating  on ProductDate POST|Distinguishing this ProductDate from other ProductDates with the same partition key|
| `displayName?`|String|A human-readable name for this ProductDate.|Administrators on PUT/POST|Providing a  human-readable title of the offering captured by this ProductDate (likely administrator facing)|
| `description?`| String| Descriptive text explaining the operational meaning of this ProductDate|Administrators on PUT/POST|Providing a human-readable description of the offering captured by this ProductDate (may be used to explain how policies on this date differ from the parent Product)|
|`availabilitySignal`|PrimaryKey|A reference to an AvailabilitySignal object containing an eventually-consistent estimate of the availability for booking on this date.|Determined inherently from parent Product|Providing a reference to an item containing estimate of availability for display to users or for internal planning|
|`allDatesBookedIntervalIds?`|[String]|An array of DateInterval IDs representing periods of time where a Booking must contain all DateInterval dates if one date touches the DateInterval|Parent Product|Determining if a booking of this ProductDate must contain all dates within any of the defined date intervals if one of the dates in the booking touches any of the dates in the date interval|
|`assetList`|[AssetRef]|A list of assetRefs allocated for this ProductDate.|Derived from parent Product's `assetList` or overridden by administrators on PUT/POST|Determining which assetRefs are allocated through this offering on this specific date, potentially overriding the parent Product's `assetList`.|
|`reservationPolicy`|ProductDateReservationPolicyRef|Reference to the reservation policy that governs reservations of this ProductDate.|Inherited from parent Product or overridden by administrators on PUT/POST|Determining which reservation policy applies to reservations of this ProductDate, potentially overriding the parent Product's `reservationPolicy`.|
|`feePolicy`|ProductDateFeePolicyRef|Reference to the fee policy that governs fees applied to bookings of this ProductDate.|Inherited from parent Product or overridden by administrators on PUT/POST|Determining which fee policy applies to bookings of this ProductDate, potentially overriding the parent Product's `feePolicy`.|
|`creationDate`|String|ISO 8601 timestamp of when this item was created|Administrators on POST|Determining when this item was created|
|`lastUpdated`|String|ISO 8601 timestamp of when this item was last updated|Administrators on PUT/POST|Determining when this item was last updated|
|`version`|Number|Version number for optimistic locking|Automatically incremented on PUT/POST|Ensuring that updates to this item do not overwrite more recent changes made by other processes|

## AvailabilityEstimate
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`availabilitySignalVersion`|Number|The version number of the availability signal used to generate this estimate.|Copied from the latest version of the AvailabilitySignal when updated|Tracking which version of the availability signal was used to generate this estimate, which can be used to compare and determine when availability may have changed|
| `type`|String|The type of availability estimate (e.g., "exact", "tiered")|Derived from the `estimationMode` in the parent Product's `availabilityEstimationPattern`|Determining how to interpret the availability estimate for this ProductDate|
|`value`|Number or String|The value of the availability estimate, which could be a number (e.g., count of available items) or a string (e.g., "high", "medium", "low") depending on the `type`|Calculated based on the `estimationMode` and the logic defined in the availability estimation process|Providing an estimate of availability for this ProductDate that can be used for display to users or for internal planning|
|`lastUpdated`|DateTime|The timestamp of when this availability estimate was last updated.|Automatically set when the availability estimate is recalculated|Tracking the freshness of the availability estimate for this ProductDate|

## ProductDateReservationPolicyRef

A ProductDateReservationPolicyRef defines a reference to a reservation policy that governs how reservations are made for this particular ProductDate. A ProductDateReservationPolicyRef will fully resolve rules that apply at the ProductDate level.

The related ReservationPolicy is exclusively applied to this ProductDate when enforcing reservation rules. Therefore, the primary key of the ReservationPolicy can be inferred.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isDiscoverable`|Boolean|Indicates whether this ProductDate is discoverable by users.|Administrators on PUT/POST|Determining if this ProductDate should be visible to users during the booking process.|
|`isReservable`|Boolean|Indicates whether this ProductDate can be reserved by users.|Administrators on PUT/POST|Determining if users are allowed to make reservations for this ProductDate.|
|`minDailyInventory`|Number|The minimum daily inventory that must be claimed by a user to initialize a Booking|Administrators on PUT/POST|Enforcing minimum inventory requirements for reservations on this ProductDate.|
|`maxDailyInventory`|Number|The maximum daily inventory that can be claimed by a user to initialize a Booking|Administrators on PUT/POST|Enforcing maximum inventory limits for reservations on this ProductDate.|
|`temporalWindows`|ProductDateReservationTemporalWindows|The temporal windows that govern when reservations can be made for this ProductDate.|Administrators on PUT/POST|Enforcing time-based rules for when reservations can be made for this ProductDate.|
|`temporalAnchors`|ProductDateReservationTemporalAnchors|The temporal anchors that define key time points for reservation rules on this ProductDate.|Administrators on PUT/POST|Determining the reference points for time-based reservation rules for this ProductDate.|

### ProductDateReservationTemporalWindows

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`discoveryWindow`|ResolvedTemporalWindow|The temporal window during which this ProductDate is discoverable by users.|Administrators on PUT/POST|Enforcing the time period when this ProductDate is visible to users.|
|`reservationWindow`|ResolvedTemporalWindow|The temporal window during which reservations can be made for this ProductDate.|Administrators on PUT/POST|Enforcing the time period when reservations can be made for this ProductDate.|
|`restrictedBookingWindow`|ResolvedTemporalWindow|The temporal window during which reservations for this ProductDate incur a booking restriction and changes are permanently disallowed.|Administrators on PUT/POST|Enforcing the time period when reservations for this ProductDate cannot be changed.|

### ProductDateReservationTemporalAnchors

A resolved temporal anchor is functionally equivalent to a specific timestamp, but is derived from dynamic inputs such as the check-in time of a reservation. This allows for more flexible and context-aware booking rules that can adapt based on the specifics of each reservation.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`checkInAnchor`|TimeStamp|The temporal anchor defining the check-in time for this ProductDate.|Administrators on PUT/POST|Establishing the check-in time reference for arrivals on this ProductDate.|
|`checkOutAnchor`|TimeStamp|The temporal anchor defining the check-out time for this ProductDate.|Administrators on PUT/POST|Establishing the check-out time reference for departures on this ProductDate.|
|`noShowAnchor`|TimeStamp|The temporal anchor defining the time after which a reservation for this ProductDate is considered a no-show.|Administrators on PUT/POST|Establishing the reference time for determining no-shows for arrivals this ProductDate.|

## ProductDatePartyPolicyRef

A ProductDatePartyPolicyRef defines a reference to a party policy that governs how parties are managed for this particular ProductDate. A ProductDatePartyPolicyRef will fully resolve rules that apply at the ProductDate level.

The related PartyPolicy is exclusively applied to this ProductDate when enforcing party rules. Therefore, the primary key of the PartyPolicy can be inferred.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`partyCompositionRules`|PartyCompositionRules|The rules governing what types of party members/equipment can be included in a booking and what the minimum and maximum value for each type of party member/equipment is for this ProductDate.|Administrators on PUT/POST|Determining the rules for how parties can be composed for bookings of this ProductDate.|

## ProductDateFeePolicyRef

A ProductDateFeePolicyRef defines a reference to a fee policy that governs how fees are applied to bookings of this particular ProductDate. A ProductDateFeePolicyRef will fully resolve rules that apply at the ProductDate level.

The related FeePolicy is exclusively applied to this ProductDate when enforcing fee rules. Therefore, the primary key of the FeePolicy can be inferred.

LineItems only need to be present on the ProductDate if the system is to provide a ProductDate-level fee estimate prior to booking. Otherwise, they can remain on the exclusive FeePolicy to be resolved at reservation time.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`feeSchedule`|[FeeDefinition]|The fee schedule that defines how fees are calculated for reservations of this ProductDate.|Administrators on PUT/POST|Determining the fee structure and amounts that apply to bookings of this ProductDate.|
|`lineItems`|[LineItem]|The line items that define specific fee calculations for this ProductDate.|Administrators on PUT/POST|Defining how fees are calculated and applied to bookings of this ProductDate.|

## ProductDateChangePolicyRef

A ProductDateChangePolicyRef defines a reference to a change policy that governs how changes/refunds are handled for this particular ProductDate. A ProductDateChangePolicyRef will fully resolve rules that apply at the ProductDate level.

The related ChangePolicy is exclusively applied to this ProductDate when enforcing change/refund rules. Therefore, the primary key of the ChangePolicy can be inferred.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`temporalWindows`|ProductDateChangeTemporalWindows|The temporal windows that govern when changes/refunds can be made for this ProductDate.|Administrators on PUT/POST|Enforcing time-based rules for when changes/refunds can be made for this ProductDate.|

### ProductDateChangeTemporalWindows

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`changeWindow`|ResolvedTemporalWindow|The temporal window during which changes/refunds can be made for this ProductDate.|Administrators on PUT/POST|Enforcing the time period when changes/refunds can be made for this ProductDate.|
|`cancellationWindow`|ResolvedTemporalWindow|The temporal window during which changes/refunds can be made for this ProductDate.|Administrators on PUT/POST|Enforcing the time period when changes/refunds can be made for this ProductDate.|

```json
--8<-- "datatypes/examples/product-date1.json"
```