# Product

A product is a specific, governed instance of an activity - they are what BC Parks 'offers' to match a visitor's wants. Products are coupled closely with ProductDates, which resolve how the Product experience is offered on a specific calendar day. Products act as the _general definition_ of an offering, while ProductDates act as the _time-specific execution_ of that offering. Products provide the structure, identity, and administrative control needed to generate ProductDates, which in turn influence and manage availability, bookings, and day-specific operations.

For example, a Product might be "Backcountry Camping on the Bedwell Lakes Trail - 2026 Season", which defines the general offering and rules for that offering, while each ProductDate seeded from that Product would represent the execution of that offering on a specific date (e.g., "Backcountry Camping on the Bedwell Lakes Trail on May 1st, 2026").

## Product Assertions

- Each Product must have a unique combination of `collectionId`, `activityType`, `activityId`, and `productId` to ensure distinct offerings within the same activity context.
- For each Product, at most one ProductDate will be created for each date in the Product's defined date range. ProductDates inherit many rules and policies from their parent Product, but also have the ability to override certain aspects to accommodate day-specific needs.
- In cases where the rules of a Product must change on a more frequent cadence than daily, multiple Products should be created to represent these variations, each with their own date ranges and associated ProductDates. Example: AM and PM trail pass offerings for the same trail on the same day would be represented as two separate Products, each with their own ProductDates for that day.
- On dates where no ProductDate exists for a Product, the Product is effectively inactive and cannot be booked on that date.

## Products vs. Activities

Activities and Products may appear similar at first glance - they both describe something a visitor can do, but they serve fundamentally different roles in the system. Keeping them separate preserves clarity in the discovery experience, stability in the data model, and flexibility in how offerings evolve over time.

**Activities** describe the place-anchored idea of an experience. They are discoverable at all times, so that site visitors can see the potential experiences that are associated with a specific place, essentially showing 'what the place is known for', even if it is not currently reservable.

**Products** turn the idea of an Activity into one or more reservable offerings. They are not always discoverable - typically only when they are being offered - and come complete with the governing rules that enable the site visitor to actually obtain the experience described by the Activity.

If an Activity is the 'experience', the Product is the 'offering' visitors can obtain to get their desired experience.

## Products as Booking Governance Modules

Products encapsulate the key governance elements that define how an offering is made available to visitors. Governance elements (policies) that apply at the Product level of scope include:

- Discoverability rules (e.g., when the offering appears in search results)
- Minimum/maximum total days for reservations of this Product
- Which Assets are allocated to this Product and how they are allocated (e.g., fixed vs. flex)
- Itinerary rules (e.g., entry/exit points, overnight stays)
- Fee policies that define how fees are calculated at the Product level
- Other high-level rules that apply to the offering as a whole, or that cannot vary on a per-day basis.

The Product also defines the date range over which ProductDates will be created, and provides the template from which those ProductDates inherit their initial rules and policies.

# Properties

## Product

| property|type|description|derived from|evaluated when|
|---|---|---|---|---|
| `pk`|String|Partition key|product::`collectionId`::`activityType`::`activityId`|Searching for all Products related to a specific Activity.|
| `sk`|String|Sort key| `productId`|Searching for a specific Product related to a specific Activity
|`gsipk?`|String|Global secondary index partition key|Reserved|Reserved|
|`gsisk?`|String|Global secondary index sort key|Reserved|Reserved|
| `schema`|String|Data type/Schema| "product" |Identifying that this item is a "product"
| `globalId`| String|Globally unique UUID|Automatically generating on Product POST| Searching for this specific item using the `globalId` GSI
|`collectionId`|String|The identifier of the collection this Product belongs to|Parent Activity's `collectionId`|Determining which collection this Product belongs to|
| `productId`|Number|Uniquely identifies this Product from other Products with the same partition key|Automatically generating  on Product POST|Distinguishing this Product from other Products with the same partition key|
| `identifier`|Number| Uniquely identifies this item from other items with the same partition key (similar to `productId`)|Copying `productId`|Distinguishing this item from other items with the same partition key|
| `activityType`|String|The type of activity this Product offers|Parent Activity's `activityType`|Determining what type of Activity this product offers|
| `activityId`|Number|The unique identifier of the parent Activity|Parent Activity's `activityId`|Determining which specific Activity of `activityType` within the `collectionId` that this Product refers to|
| `activitySubType?`|String|A further categorization of the type of Activity this Product offers, if available | Parent Activity's `activitySubType`|Determining what type of `activitySubType` this Product offers|
| `displayName`|String|A human-readable name for this Product.|Administrators on PUT/POST|Providing a public facing, human-readable title of the offering captured by this Product|
| `description`| String| Descriptive text explaining the operational meaning of this Product|Administrators on PUT/POST|Providing a public facing, human-readable description of the offering captured by this Product.|
|`timezone`|String|IANA timezone identifier for the location where this Product is offered|Administrators on PUT/POST|Determining the timezone context for date and time calculations related to this Product|
| `rangeStart`|Date|First date in the range of date this Product enables|Administrators on PUT/POST|Determining the date before which no child `productDates` will be generated on ProductDate seed|
| `rangeEnd`|Date|Last date in the range of date this Product enables|Administrators on PUT/POST|Determining the date after which no child `productDates` will be generated on ProductDate seed|
| `assetList`|[[AssetRef](#assetref)]|A list of assets associated with the product|Administrators on PUT/POST|Determining which assets are allocated through this offering|
|`availabilityEstimationPattern`|[AvailabilityEstimationPattern](#availabilityestimationpattern)|Pattern governing how availability is estimated for ProductDates related to this Product|Administrators on PUT/POST|Determining how availability is estimated for ProductDates related to this Product|
|`itineraryRules?`|[ItineraryRules](#itineraryrules)|Rules governing how itineraries are validated for bookings of this Product|Administrators on PUT/POST|Determining how itineraries are validated for bookings of this Product|
|`waitRoomConfig`|[WaitRoomConfig](#waitroomconfig)|Configuration for wait room behavior for this Product (future consideration)|Administrators on PUT/POST|Determining how to handle excess demand for bookings of this Product|
|`allDatesReservedIntervals?`|[[DateInterval](#dateinterval)]|An array of date intervals representing periods of time where a Booking must contain all DateInterval dates if one date touches the DateInterval|Administrators on PUT/POST|Determining if a booking of this Product must contain all dates within any of the defined date intervals if one of the dates in the booking touches any of the dates in the date interval|
|`reservationPolicy`|[ProductReservationPolicyRef](#productreservationpolicyref)|Reference to the reservation policy that governs reservations of this Product|Administrators on PUT/POST|Determining which reservation policy applies to reservations of this Product|
|`partyPolicy`|[ProductPartyPolicyRef](#productpartypolicyref)|Reference to the booking policy that governs bookings of this Product|Administrators on PUT/POST|Determining which booking policy applies to bookings of this Product|
|`feePolicy`|[ProductFeePolicyRef](#productfeepolicyref)|Reference to the fee policy that governs fees associated with this Product|Administrators on PUT/POST|Determining which fee policy applies to bookings of this Product|
|`changePolicy`|[ProductChangePolicyRef](#productchangepolicyref)|Reference to the change policy that governs changes/refunds for this Product|Administrators on PUT/POST|Determining which change policy applies to changes/refunds for this Product|
|`creationDate`|String|ISO 8601 timestamp of when this item was created|Administrators on POST|Determining when this item was created|
|`lastUpdated`|String|ISO 8601 timestamp of when this item was last updated|Administrators on PUT/POST|Determining when this item was last updated|
|`version`|Number|Version number for optimistic locking|Automatically incremented on PUT/POST|Ensuring that updates to this item do not overwrite more recent changes made by other processes|

## AssetRef

An AssetRef defines a reference to an asset and the quantity of that asset allocated to a Product. A Products `assetList` is an array of AssetRefs.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`primaryKey`|PrimaryKey|The primary key of the referenced Asset|Administrators on PUT/POST|Identifying which Asset is being referenced|
|`assetType?`|String|The type of the referenced Asset (e.g., "campsite", "boat slip")|Referenced Asset|Determining the type of the referenced Asset|
|`allocationType`|String|The type of allocation for this Asset within the Product (e.g., "fixed", "flex")|Referenced Asset|Determining how the referenced Asset is allocated to this Product|
|`quantity`|Number|The quantity of the referenced Asset allocated to this Product|Administrators on Product PUT/POST|Determining how many units of the referenced Asset are allocated to this Product (will be 1 in "fixed" cases, and a base-level capacity in "flex" cases)|

## AvailabilityEstimationPattern

An AvailabilityEstimationPattern defines the pattern used to estimate availability for ProductDates related to a Product. This pattern helps in providing an eventually-consistent estimate of availability for booking on each date.

ProductDates are high-traffic items that are read-optimized. To keep an accurate availability count on each ProductDate would require a write operation on every booking, which could lead to performance issues. Instead, the system uses an eventually-consistent approach to availability estimation, where availability is estimated based on a defined pattern and updated on a regular cadence.

Each ProductDate generates a tiny, cheap, high-frequency AvailabilitySignal item. When availability for that date is affected, a monotonic counter on the AvailabilitySignal is incremented. In periods of high traffic, this counter may be incremented thousands of times per second. Then, on a cadence defined by AvailabilityEstimationPattern, a process will read the counter value from the AvailabilitySignal, compare it to the last saved counter value on the ProductDate, and if the values differ, perform a more rigorous availability estimate. This allows the system to provide a reasonably up-to-date estimate of availability without needing to perform expensive write operations on the ProductDate for every booking. Additionally, the estimation check does not occur if the counter value has not changed since the last estimate, which helps to further reduce unnecessary processing during periods of low traffic.

If `estimationMode` is set to "exact", the system will provide a count of available items on the cadence increment. If `estimationMode` is set to "tiered", the system will provide a tier of availability (e.g., "high", "medium", "low") based on thresholds defined in the AvailabilityEstimationPattern.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`estimationMode`|String|The mode of availability estimation (e.g., "exact", "tiered")|Administrators on Product PUT/POST|Determining the mode of availability estimation for ProductDates related to this Product|
|`cadence`|[CadenceBucket](#cadencebucket)|The frequency at which availability estimation should occur (e.g., every 5 minutes)|Administrators on Product PUT/POST|Determining how often availability estimation should occur for ProductDates related to this Product|
|`tiers?`|[AvailabilityTier](#availabilitytier)|Optional ordered array of availability tiers with thresholds, used if `estimationMode` is set to "tiered"|Administrators on Product PUT/POST|Defining the availability tiers and their corresponding thresholds for tiered availability estimation|

### CadenceBucket

A CadenceBucket defines the frequency at which availability estimation should occur for ProductDates related to a Product. The system will trigger availability estimation checks on the associated ProductDates at intervals defined by the CadenceBucket. Each CadenceBucket corresponds to an AWS EventBridge rule that triggers the availability estimation process on the defined cadence. For example, if a Product has a cadence of "5min", the system will perform availability estimation checks for its ProductDates every 5 minutes. All Products of the same CadenceBucket can be processed in a single batch job triggered by the corresponding EventBridge rule, allowing for efficient handling of availability estimation across multiple Products.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|Unique identifier for the cadence bucket|Administrators on Product PUT/POST|Distinguishing this cadence bucket from others in the same estimation pattern|
|`label`|String|The label for this cadence bucket (e.g., "5min", "15min", "30min")|Administrators on Product PUT/POST|Providing a human-readable label for this cadence bucket|

### AvailabilityTier

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|Unique identifier for the availability tier|Administrators on Product PUT/POST|Distinguishing this availability tier from others in the same estimation pattern|
|`label`|String|The label for this availability tier (e.g., "high", "medium", "low")|Administrators on Product PUT/POST|Providing a human-readable label for this availability tier|
|`maxPercentage`|Number|The maximum percentage of availability for this tier (e.g., 0.7 for 70%)|Administrators on Product PUT/POST|Determining the upper threshold of availability for this tier in tiered availability estimation|

## ItineraryRules

ItineraryRules define the rules governing how itineraries are collected for the Product. Some offerings may require entry and exit points, expected locations for overnight stays, or both. This is particularly relevant for activities such as multi-day hiking or boating trips - but the information collected is primarily used for informational purposes and visitor safety (SAR) and does not impact availability or inventory management.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`entryExit`|[AccessPointRules](#accesspointrules)|Rules governing entry and exit points for itineraries|Administrators on Product PUT/POST|Determining how entry and exit points are managed for Bookings of this Product|
|`stayPoints`|[OvernightStayRules](#overnightstayrules)|Rules governing overnight stays for itineraries|Administrators on Product PUT/POST|Determining how overnight stays are managed for Bookings of this Product|

### AccessPointRules
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`required`|Boolean|Whether entry and exit points are required for itineraries|Administrators on Product PUT/POST|Determining if entry and exit points must be specified for Bookings of this Product|
|`allowedEntryPoints?`|[PrimaryKey]|List of allowed Facility primary keys to be used as entry points|Administrators on Product PUT/POST|Determining which Facilities are allowed as entry points for Bookings|
|`allowedExitPoints?`|[PrimaryKey]|List of allowed Facility primary keys to be used as exit points|Administrators on Product PUT/POST|Determining which Facilities are allowed as exit points for Bookings|

### OvernightStayRules
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`required`|Boolean|Whether overnight stays are required for itineraries|Administrators on Product PUT/POST|Determining if overnight stays must be specified for Bookings of this Product|
|`allowedStayPoints?`|[PrimaryKey]|List of allowed Facility primary keys to be used as overnight stay points|Administrators on Product PUT/POST|Determining which Facilities are forwarded to each ProductDate on seeding to populate the overnight stay points|

## WaitRoomConfig

Future consideration.

## DateInterval

A DateInterval defines a group of dates. If a booking touches any of the dates in the DateInterval, the booking must include all of the dates in the DateInterval. This is used to enforce rules such as "if a visitor books May 1st, they must also book May 2nd and May 3rd" for a Product that has an allDatesBookedInterval that includes May 1st, May 2nd, and May 3rd.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|Unique identifier for the date interval|Administrators on Product PUT/POST|Distinguishing this date interval from others in the same Product|
|`label`|String|The label for this date interval (e.g., "May Long Weekend")|Administrators on Product PUT/POST|Providing a human-readable label for this date interval|
|`startDate`|Date|The first date in the date interval|Administrators on Product PUT/POST|Determining the start date of the date interval|
|`endDate`|Date|The last date in the date interval|Administrators on Product PUT/POST|Determining the end date of the date interval|

## ProductReservationPolicyRef
A ProductReservationPolicyRef defines a reference to a reservation policy that governs how reservations are made for a Product. A reservation policy will include rules that apply at the Product level, and rules that will be inherited by each ProductDate created for the Product. A ProductReservationPolicyRef will fully resolve rules that apply at the Product level, and will include a reference to the ReservationPolicy for for rules that will be applied at the ProductDate level when seeding.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`primaryKey`|PrimaryKey|The primary key of the referenced Reservation Policy|Administrators on PUT/POST|Identifying which Reservation Policy is being referenced for this Product|
|`isDiscoverable`|Boolean|Whether this Product is discoverable for reservation searches. If true, the `discoveryWindow` is used to determine discoverability. If false, the Product cannot be discovered.|Referenced Reservation Policy|Determining if this Product appears in reservation search results|
|`isReservable`|Boolean|Whether this Product can be reserved. If true, ProductDates can be queried for this Product. If false, the Product cannot be reserved.|Referenced Reservation Policy|Determining if this Product can be reserved|
|`minTotalDays`|Number|Minimum total days for reservations of this Product|Referenced Reservation Policy|Enforcing minimum total days for reservations of this Product|
|`maxTotalDays`|Number|Maximum total days for reservations of this Product|Referenced Reservation Policy|Enforcing maximum total days for reservations of this Product|
|`holdDuration`|Duration|The length of time that a reservation of this Product can be held in a cart before it expires|Referenced Reservation Policy|Enforcing cart duration for reservations of this Product|
|`temporalWindows`|[ProductReservationTemporalWindows](#productreservationtemporalwindows)|Temporal windows governing reservation availability for this Product|Referenced Reservation Policy|Enforcing temporal windows for reservations of this Product|

### ProductReservationTemporalWindows
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`discoveryWindow`|[ResolvedTemporalWindow](#resolvedtemporalwindow)|The discovery window for this Product.|Referenced Reservation Policy|Enforcing the discovery window for this Product|

### ResolvedTemporalWindow
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`open`|Timestamp|The opening timestamp of the temporal window|Referenced Temporal Window|Enforcing the opening timestamp of the temporal window|
|`close`|Timestamp|The closing timestamp of the temporal window|Referenced Temporal Window|Enforcing the closing timestamp of the temporal window|

## ProductPartyPolicyRef
A ProductPartyPolicyRef defines a reference to a party policy that governs how Inventory can be consumed once reserved. A party policy will include rules that apply at the Product level, and rules that will be inherited by each ProductDate created for the Product. A ProductPartyPolicyRef will fully resolve rules that apply at the Product level, and will include a reference to the PartyPolicy for rules that will be applied at the ProductDate level when seeding.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`primaryKey`|PrimaryKey|The primary key of the referenced Party Policy|Administrators on PUT/POST|Identifying which Party Policy is being referenced for this Product|

## ProductFeePolicyRef
A ProductFeePolicyRef defines a reference to a fee policy that governs how fees are applied to bookings of a Product. A fee policy will include rules that apply at the Product level, and rules that will be inherited by each ProductDate created for the Product. A ProductFeePolicyRef will fully resolve rules that apply at the Product level, and will include a reference to the FeePolicy for for rules that will be applied at the ProductDate level when seeding.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`primaryKey`|PrimaryKey|The primary key of the referenced Fee Policy|Administrators on Product PUT/POST|Identifying which Fee Policy is being referenced for this Product|
|`feeSchedule?`|[[feeDefinition](#feedefinition)]|The fee schedule associated with this Product|Referenced Fee Policy|Determining which fee components are used in the Product-level line items of this Product|
|`lineItems?`|[[LineItem](#lineitem)]|The line items associated with this Product|Referenced Fee Policy|Determining how this Product is charged for at a Product level|

### FeeDefinition

A single component of a fee schedule that defines a specific fee that can be applied to bookings of a Product. FeeSchedules are made up of multiple FeeDefinitions.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|Unique identifier for the fee component|Administrators on FeePolicy PUT/POST|Distinguishing this fee component from others in the same fee schedule|
|`label`|String|Human-readable label for the fee component|Administrators on FeePolicy PUT/POST|Providing a public facing, human-readable title of this fee component|
|`type`|String|Type of fee (e.g., "flat", "percentage", "unit")|Administrators on FeePolicy PUT/POST|Determining how this fee component is intended to be utilized|
|`amount`|Number|The base amount for the fee component|Administrators on FeePolicy PUT/POST|Determining the base amount used in calculations for this fee component|

### LineItem

A single line item that defines how a fee is calculated and applied to bookings of a Product. LineItems are made up of multiple calculation steps that reference FeeDefinitions from the FeeSchedule, or other LineItems. When provided as part of a ProductFeePolicyRef, LineItems define how to charge for the Product at a Product level. These line items will be supplemented by additional line items defined at the ProductDate level when seeding.

LineItems only need to be present on the Product if the system is to provide a Product-level fee estimate prior to selecting specific dates. Otherwise, they can remain on the FeePolicy to resolved at reservation time.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|Unique identifier for the line item|Administrators on FeePolicy PUT/POST|Distinguishing this line item from others in the same fee policy|
|`label`|String|Human-readable label for the line item|Administrators on FeePolicy PUT/POST|Providing a public facing, human-readable title of this line item|
|`type`|String|The type of line item (e.g., "flat", "unit")|Administrators on FeePolicy PUT/POST|Determining how this line item is processed in the overall fee calculation|
|`role`|String|The role of this line item (e.g., "total", "subTotal", "tax")|Administrators on FeePolicy PUT/POST|Categorizing this line item for internal processing and reporting|
|`tags?`|[String]|Optional tags associated with this line item|Administrators on FeePolicy PUT/POST|Categorizing or labeling this line item for easier identification and conditional UI rendering|
|`if`|[ComparisonPrimitive]|Optional conditions that must be met for this line item to be applied|Administrators on FeePolicy PUT/POST|Determining if this line item should be applied based on booking context|
|`quantity`|ReferencePrimitive|The quantity used in calculating this line item. `type = flat` means `quantity` is automatically 1|Administrators on FeePolicy PUT/POST|Determining the quantity factor used in calculating this line item|
|`rate`|ReferencePrimitive|The rate used in calculating this line item. `type = unit` means `rate` is applied per unit|Administrators on FeePolicy PUT/POST|Determining the rate factor used in calculating this line item|
|`taxApplied?`|[ReferencePrimitive]|Optional list of taxes applied to this line item|Administrators on FeePolicy PUT/POST|Determining which taxes are applied per-unit or flatly to this line item|
|`discountsApplied?`|[ReferencePrimitive]|Optional list of discounts applied to this line item|Administrators on FeePolicy PUT/POST|Determining which discounts are applied per-unit or flatly to this line item|
|`isReturnable`|Boolean|Whether this line item is eligible for return/refund|Administrators on FeePolicy PUT/POST|Determining if this line item can be refunded during a return process|

## ProductChangePolicyRef

A ProductChangePolicyRef defines a reference to a change policy that governs how changes/refunds are handled for a Product. A change policy will include rules that apply at the Product level, and rules that will be inherited by each ProductDate created for the Product. A ProductChangePolicyRef will fully resolve rules that apply at the Product level, and will include a reference to the ChangePolicy for rules that will be applied at the ProductDate level when seeding.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`primaryKey`|PrimaryKey|The primary key of the referenced Change Policy|Administrators on Product PUT/POST|Identifying which Change Policy is being referenced for this Product|
|`rules`|[[ChangePolicyRule](#changepolicyrule)]|The change/refund rules that apply to this Product|Referenced Change Policy|Determining how changes and refunds are handled for this Product|

### ChangePolicyRule

Returns will only be processed if the change request falls within the temporal window defined in the rule, and if any conditions defined in the `if` property are met. None of rules can have temporal windows that overlap. If a change request does not meet the conditions of any of the rules, it will be rejected.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|Unique identifier for the change policy rule|Administrators on ChangePolicy PUT/POST|Distinguishing this change policy rule from others in the same change policy|
|`label`|String|Human-readable label for the change policy rule|Administrators on ChangePolicy PUT/POST|Providing a public facing, human-readable title of this change policy rule|
|`type`|String|The type of refund applied in this rule (e.g. "flat", "percentage")|Administrators on ChangePolicy PUT/POST|Determining how refunds are calculated when this rule is applied|
|`amount`|Number|The base amount used in calculating refunds for this rule|Administrators on ChangePolicy PUT/POST|Determining the base amount used in calculating refunds when this rule is applied|
|`if`|[ComparisonPrimitive]|Optional conditions that must be met for this change policy rule to be applied|Administrators on ChangePolicy PUT/POST|Determining if this change policy rule should be applied based on booking context|
|`temporalWindow`|[ResolvedTemporalWindow](#resolvedtemporalwindow)|A temporal window that determines when this change policy rule is applied based on the timing of the change request|Administrators on ChangePolicy PUT/POST|Determining if this change policy rule should be applied based on the timing of the change request|


## Example Product

Below is an example of a ficticious Product item that might be stored in the database. This example represents a backcountry camping offering for a specific park (Mock Park 1) for the 2026 season. It encodes the following details:

- The Product is associated with the "backcountryCamp" activity type and has a unique productId of 1 within that activity context.
- The Product will generate ProductDates (and therefore be support offerings) from May 1st to October 31st, 2026, and is in the "America/Vancouver" IANA timezone.
- The Product allocates 3 specific campsites (campsite 1, 2, and 3 in campground 1 of Mock Park 1) as fixed assets for this offering.
- The Product uses an availability estimation pattern that provides exact availability estimates every 5 minutes.
- The itinerary rules require entry and exit points, allowing accessPoint 1 and 2 of Mock Park 1 as valid options, and require overnight stays with allowed stay points at campground 1 and 2 of Mock Park 1.
- The Product references a reservation policy that makes it discoverable and reservable, with a minimum total days of 1 and a maximum total days of 14, and a discovery window from January 1st to December 31st, 2026.
- The Product references a booking policy that will be inherited by seeded ProductDates.
- The Product references a fee policy that includes a fee schedule with a flat transaction fee of $6.5 and a tax of 5%, and a line item that applies the transaction fee and associated tax to the Product at a Product level.
- The Product references a change policy that will be inherited by seeded ProductDates.

```json
--8<-- "datatypes/examples/product1.json"
```