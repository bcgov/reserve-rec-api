# Booking

A Booking is a concept that limits/enforces valid groupings of inventory that can be purchased together at the same time. They are the authoritative record of a customer committing to a specific Product, capturing the exact Inventory consumed, the policy snapshots applied, and the operational state of the reservation at the moment it was created. They are the ledger entry that ties together customer intent, product configuration, Inventory allocation, and pricing logic, forming the durable truth the rest of the system reacts to.

A Booking exists as an isolated, self-contained unit because the system must be able to reason about its contents deterministically. It represents the valid range of inventory groupings that can be purchased together under a single, coherent set of policies. Just as Inventory is the atomic unit of availability, a Booking is the atomic unit of reservation, though the rules around what constitutes a Booking vary much more broadly than Inventory.

Similar to how ProductDates are the date-specific execution of Products, Bookings too have date-specific instances called BookingDates. Each BookingDate corresponds to a specific date within the overall Booking period, allowing the system to track and manage availability and allocations on a per-day basis. This design enables the system to handle complex scenarios like multi-day bookings, partial cancellations, and date-specific adjustments while maintaining a clear and consistent record of the booking history. Each BookingDate is associated with the relevant ProductDate and Inventory units for that date, ensuring that all changes to the booking are accurately reflected in the system's state and availability calculations.

# Properties

## Booking
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`pk`|String|Partition key|booking::`collectionId`:: `activityType`::`activityId`:: `productId`|Searching for all Bookings related to a specific Product.|
|`sk`|String|Sort key|`arrivalDate`::`bookingId`|Searching for a specific Booking related to a specific Product (disambiguated by bookingId)|
|`gsipk`|String|Global secondary index partition key|`userSub`|Querying for all Bookings made by a specific customer|
|`gsisk`|String|Global secondary index sort key|`arrivalDate`|Sorting a customer's Bookings by arrival date|
| `schema`|String|Data type/Schema| "booking" |Identifying that this item is a "booking"|
| `globalId`| String|Globally unique UUID|Automatically generating on Booking POST| Searching for this specific item using the `globalId` GSI
|`collectionId`|String|The identifier of the collection this Booking belongs to|Parent Product's `collectionId`|Determining which collection this Booking belongs to|
| `activityType`|String|The type of activity this Booking is for|Parent Product's `activityType`|Determining what type of Activity this Booking is for|
|`activitySubType?`|String|A further categorization of the type of Activity this Booking is for, if available | Parent Product's `activitySubType`|Determining what type of `activitySubType` this Booking is for|
| `activityId`|Number|The unique identifier of the parent Activity|Parent Product's `activityId`|Determining which specific Activity of `activityType` within the `collectionId` that this Booking refers to|
| `productId`|Number|The unique identifier of the parent Product|Parent Product's `productId`|Determining which specific Product this Booking refers to|
| `bookingId`|String|Unique identifier for this Booking (distinct from `globalId` for traceability purposes)|Automatically generating on Booking POST|Distinguishing this Booking from other Bookings related to the same Product|
|`userSub`|String|The unique identifier of the customer who made the booking|Provided by client on Booking POST|Associating this Booking with the customer who made it|
|`status`|String|The current status of the booking (e.g., "held". "pending", "completed", "cancelled")|Automatically setting on Booking POST and updating on status changes|Tracking the lifecycle state of the booking|
|`timezone`|String|IANA timezone identifier for the location where this Booking is reserved|Inherited from parent Product|Ensuring that all date and time calculations related to this Booking are performed in the correct timezone context|
|`asset`|[AssetRef](#assetref)|The asset allocated through this Booking|Derived from parent Product's assetList and Inventory allocation|Tracking which specific asset is allocated through this Booking|
|`itineraryRulesSnapshot`|[ItineraryRules](#itineraryrules)|The snapshot of the itinerary rules applied to this Booking at the time of booking|Derived from parent Product's Itinerary Rules at the time of booking|Capturing the itinerary rules context for this Booking at the moment it was created|
|`itinerary?`|[ResolvedItinerary](#resolveditinerary)|The resolved itinerary for this Booking, if applicable|Derived from parent Product's Itinerary Rules and the customer's requested itinerary at the time of booking|Capturing the specific itinerary for this Booking if the Product has itinerary rules that require resolution at the time of booking|
|`reservationPolicySnapshot`|[BookingReservationPolicSnapshot](#bookingreservationpolicysnapshot)|The snapshot of the reservation policy applied to this Booking at the time of booking|Derived from parent Product's Reservation Policy at the time of booking|Capturing the reservation policy context for this Booking at the moment it was created|
|`reservationValues`|[BookingReservationValues](#bookingreservationvalues)|The resolved reservation values of this Booking|Derived from parent Product's Reservation Policy and client input on Booking POST|Capturing the specific reservation values for this Booking based on the Product's Reservation Policy and customer input|
|`partyPolicySnapshot`|[BookingPartyPolicySnapshot](#bookingpartypolicysnapshot)|The snapshot of the party policy applied to this Booking at the time of booking|Derived from parent Product's Party Policy at the time of booking|Capturing the party policy context for this Booking at the moment it was created|
|`partyValues`|[BookingPartyValues](#bookingpartyvalues)|The resolved party composition values of this Booking|Derived from parent Product's Party Policy and client input on Booking POST|Capturing the specific party composition for this Booking based on the Product's Party Policy and customer input|
|`feePolicySnapshot`|[ProductFeePolicyReference](#productfeepolicy)|The snapshot of the fee policy applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy at the time of booking|Capturing the fee policy context for this Booking at the moment it was created|
|`feeValues`|[BookingFeeValues](#bookingfeevalues)|The resolved fee values of this Booking|Derived from parent Product's Fee Policy and client input on Booking POST|Capturing the specific fee values for this Booking based on the Product's Fee Policy and customer input|
|`changePolicySnapshot`|[ProductChangePolicyRef](#productchangepolicyref)|The snapshot of the change policy applied to this Booking at the time of booking|Derived from parent Product's referenced Change Policy at the time of booking|Capturing the change policy context for this Booking at the moment it was created|
|`bookingDates`|[PrimaryKey]|List of primary keys of the BookingDates associated with this Booking|Automatically generating on Booking POST based on the date range of the booking|Tracking the specific BookingDates that are part of this Booking|


## BookingTemporalWindows

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`changeWindow`|ResolvedTemporalWindow|The change window for this Booking.|Derived from parent Product's Reservation Policy|Enforcing the change window for this Booking|
|`cancellationWindow`|ResolvedTemporalWindow|The cancellation window for this Booking.|Derived from parent Product's Reservation Policy|Enforcing the cancellation window for this Booking|

## ResolvedItinerary

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`entryPoint?`|[ResolvedItineraryPoint](#resolveditinerarypoint)|The resolved entry point for this Booking, if applicable|Derived from parent Product's Itinerary Rules and the customer's requested itinerary at the time of booking|Capturing the specific entry point for this Booking if the Product has itinerary rules that require resolution at the time of booking|
|`exitPoint?`|[ResolvedItineraryPoint](#resolveditinerarypoint)|The resolved exit point for this Booking, if applicable|Derived from parent Product's Itinerary Rules and the customer's requested itinerary at the time of booking|Capturing the specific exit point for this Booking if the Product has itinerary rules that require resolution at the time of booking|
|`stayPoints?`|[[ResolvedItineraryPoint](#resolveditinerarypoint)]|The resolved stay points for this Booking, if applicable|Derived from parent Product's Itinerary Rules and the customer's requested itinerary at the time of booking|Capturing the specific stay points for this Booking if the Product has itinerary rules that require resolution at the time of booking|

## ResolvedItineraryPoint

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`primaryKey`|PrimaryKey|The primary key of the referenced Access Point or Overnight Stay point|Derived from parent Product's Itinerary Rules and the customer's requested itinerary at the time of booking|Identifying which specific Access Point or Overnight Stay this itinerary point refers to|
|`date`|Date|The date of this itinerary point|Derived from the customer's requested itinerary at the time of booking|Capturing the specific date for this itinerary point|
|`displayName`|String|The display name of this itinerary point|Derived from the referenced Access Point or Overnight Stay point|Providing a human-readable name for this itinerary point|

## BookingReservationPolicySnapshot

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isDiscoverable`|Boolean|Whether this Booking was discoverable for reservation searches.|Parent Product|Determining if this Product appears in reservation search results|
|`isReservable`|Boolean|Whether this Booking was able to be reserved.|Parent Product|Determining if this Product can be reserved|
|`minTotalDays`|Number|Minimum total days this Booking must span|Parent Product|Enforcing minimum total days for reservations of this Booking|
|`maxTotalDays`|Number|Maximum total days this Booking can span|Parent Product|Enforcing maximum total days for reservations of this Booking|
|`holdDuration`|Duration|The length of time that this Booking can be held in a cart before it expires|Parent Product|Enforcing cart duration for reservations of this Booking|
|`temporalAnchors`|[BookingTemporalAnchors](#bookingtemporalanchors)|The temporal anchors that define key time points for reservation rules on this Booking.|Parent Product|Determining the reference points for time-based reservation rules for this Booking.|
|`temporalWindows`|[ProductReservationTemporalWindows](#productreservationtemporalwindows)|Temporal windows that governed reservation availability for this Booking|Parent Product|Enforcing temporal windows for reservations of this Booking|

## BookingReservationValues
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`totalDays`|Number|The total number of days for this Booking|Derived from the arrival and departure dates of this Booking|Calculating the total days for this Booking to enforce reservation policies that depend on total length of stay|
|`restrictedBookingTriggered`|Boolean|Whether this Booking has triggered any restricted booking windows based on its temporal anchors|Derived from the temporal anchors of this Booking and the reservation policy rules that define restricted booking windows|Determining if this Booking falls within any restricted booking windows that would disallow changes to the booking|
|`temporalAnchors`|`BookingTemporalAnchors`|The resolved temporal anchors for this Booking|Derived from the Booking's temporal anchors and the specific reservation policy rules that require resolution at the time of booking|Providing the specific temporal anchor values needed to enforce reservation policies for this Booking|

## BookingTemporalAnchors

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`reservationTime`|Timestamp|The reservation time anchor for this Booking|Derived from client input on Booking POST|Establishing the reservation time context for this Booking|
|`holdExpiryTime`|Timestamp|The hold expiry time anchor for this Booking|Derived from client input on Booking POST and updated if the booking hold is extended|Establishing the hold expiry time context for this Booking|
|`completionTime?`|Timestamp|The completion time anchor for this Booking|Derived from client input on Booking POST and updated when the booking is finalized|Establishing the completion time context for this Booking|
|`arrivalDate`|Date|The arrival date anchor for this Booking|Derived from client input on Booking POST|Establishing the arrival date context for this Booking|
|`departureDate`|Date|The departure date anchor for this Booking|Derived from client input on Booking POST|Establishing the departure date context for this Booking|
|`checkInAfter`|Timestamp|The check-in after time anchor for this Booking|Derived from client input on Booking POST|Establishing the check-in after time context for this Booking|
|`checkOutBefore`|Timestamp|The check-out before time anchor for this Booking|Derived from client input on Booking POST|Establishing the check-out before time context for this Booking|
|`noShowAfter`|Timestamp|The no-show after time anchor for this Booking|Derived from client input on Booking POST|Establishing the no-show after time context for this Booking|

## BookingPartyPolicySnapshot

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`partyCategories`|[[PartyCategory](policies/party-policies.md#partycategory)]|The snapshot of the party category rules applied to this Booking at the time of booking|Derived from parent Product's Party Policy at the time of booking|Capturing the specific party category rules for this Booking based on the Product's Party Policy at the moment it was created|
|`partyCompositionRules`|[[ElegibilityPrimitive](#eligibilityprimitive)]|The snapshot of the party composition rules applied to this Booking at the time of booking|Derived from parent Product's Party Policy at the time of booking|Capturing the specific party composition rules for this Booking based on the Product's Party Policy at the moment it was created|


## BookingPartyValues
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`partyComposition`|[PartyCompositionUnit](#partycompositionunit)|The resolved party composition for this Booking|Derived from parent Product's Party Policy and client input on Booking POST|Capturing the specific party composition for this Booking based on the Product's Party Policy and customer input|

### PartyCompositionUnit

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|The unique identifier for this party composition unit|Derived from BookingPartyPolicySnapshot|Identifying this specific party composition unit|
|`label`|String|The display name for this party composition unit|Derived from BookingPartyPolicySnapshot|Providing a human-readable name for this party composition unit|
|`count`|Number|The number of party members/equipment included in this booking for this unit|Derived from client input on Booking POST|Capturing the specific count for this party composition unit in this Booking|

## BookingFeePolicySnapshot
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`feeSchedule`|[FeeSchedule](#feeschedule)|The snapshot of the fee schedule applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy at the time of booking|Capturing the specific fee schedule for this Booking based on the Product's Fee Policy at the moment it was created|
|`lineItems`|[LineItem](#lineitem)|The snapshot of the fee line items applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy and client input on Booking POST at the time of booking|Capturing the specific fee line items for this Booking based on the Product's Fee Policy and customer input at the moment it was created|

## BookingFeeValues
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`bookingDateTotals`|[BookingDateFeeTotal](#bookingdatefeetotals)|The breakdown of fee totals for each BookingDate within this Booking|Derived from BookingFeePolicySnapshot and client input on Booking POST|Calculating the fee totals for each BookingDate within this Booking based on the fee schedule, line items, and customer input|
|`resolvedLineItems`|[ResolvedLineItem](#resolvedlineitem)|The resolved fee line items for this Booking|Derived from BookingFeePolicySnapshot and client input on Booking POST|Capturing the specific fee line items for this Booking based on the fee policy snapshot and customer input|
|`bookingDiscounts`|[ResolvedLineItemDiscount](#resolvedlineitemdiscount)|The total discount amount for this Booking|Derived from the discounts applied to the resolved line items for this Booking|Calculating the total discount for this Booking based on the discounts applied to the resolved line items|
|`bookingTaxes`|[ResolvedLineItemTax](#resolvedlineitemtax)|The total tax amount for this Booking|Derived from the taxes applied to the resolved line items for this Booking|Calculating the total tax for this Booking based on the taxes applied to the resolved line items|
|`bookingSubTotal`|Number|The subtotal fee amount for this Booking before taxes and discounts|Derived from BookingFeePolicySnapshot and client input on Booking POST|Calculating the subtotal fee for this Booking based on the fee schedule, line items, and customer input|
|`bookingTotal`|Number|The grand total fee amount for this Booking|Derived from BookingFeePolicySnapshot and client input on Booking POST|Calculating the grand total fee for this Booking based on the fee schedule, line items, and customer input|

### BookingDateFeeTotal

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`date`|Date|The date for this BookingDate fee total|Derived from the specific BookingDate this fee total corresponds to|Identifying which BookingDate this fee total corresponds to|
|`total`|Number|The total fee amount for this BookingDate|Derived from the fee schedule, line items, and customer input for this specific date|Calculating the total fee for this BookingDate based on the fee policy and customer input|

### ResolvedLineItem
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|The unique identifier for this resolved line item|Derived from BookingFeePolicySnapshot and client input on Booking POST|Identifying this specific resolved line item|
|`label`|String|The display name for this resolved line item|Derived from BookingFeePolicySnapshot and client input on Booking POST|Providing a human-readable name for this resolved line item|
|`type`|String|The type of this resolved line item (e.g., "flat", "unit")|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining how this resolved line item is processed in the overall fee calculation|
|`isReturnable`|Boolean|Whether this resolved line item is returnable/refundable|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining if this resolved line item can be refunded in the case of a cancellation or change|
|`units`|[[ResolvedLineItemUnitBreakdown](#resolvedlineitemunitbreakdown)]|The breakdown of units for this resolved line item, if applicable|Derived from BookingFeePolicySnapshot and client input on Booking POST|Providing a detailed breakdown of units for this resolved line item if it is of type "unit"|
|`lineTaxes`|[[ResolvedLineItemTax](#resolvedlineitemtax)]|The breakdown of taxes for this resolved line item, if applicable|Derived from BookingFeePolicySnapshot and client input on Booking POST|Providing a detailed breakdown of taxes for this resolved line item if it is taxable|
|`lineDiscounts`|[[ResolvedLineItemDiscount](#resolvedlineitemdiscount)]|The breakdown of discounts for this resolved line item, if applicable|Derived from BookingFeePolicySnapshot and client input on Booking POST|Providing a detailed breakdown of discounts for this resolved line item if it is discountable|
|`lineSubtotal`|Number|The subtotal amount for this line item before taxes and discounts|Derived from the quantity, rate, and type of this resolved line item|Calculating the subtotal for this line item based on its quantity, rate, and type|
|`lineTotal`|Number|The total amount for this line item after applying taxes and discounts|Derived from the line subtotal, taxes, and discounts for this resolved line item|Calculating the total for this line item based on its subtotal, taxes, and discounts|

### ResolvedLineItemUnitBreakdown

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`rate`|Number|The rate for this unit breakdown|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining the rate for this unit breakdown of the resolved line item|
|`discountApplied`|[[ResolvedLineItemDiscount](#resolvedlineitemdiscount)]|The discount applied to this unit breakdown, if applicable|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining the discount applied to this unit breakdown of the resolved line item if it is discountable|
|`unitSubTotal`|Number|The subtotal amount for this unit breakdown before taxes|Derived from the rate for this unit breakdown|Calculating the subtotal for this unit breakdown based on its rate|
|`taxApplied`|[[ResolvedLineItemTax](#resolvedlineitemtax)]|The tax applied to this unit breakdown, if applicable|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining the tax applied to this unit breakdown of the resolved line item if it is taxable|
|`unitSubTotal`|Number|The subtotal amount for this unit breakdown before taxes|Derived from the rate for this unit breakdown|Calculating the subtotal for this unit breakdown based on its rate|
|`unitTotal`|Number|The total amount for this unit breakdown after applying taxes and discounts|Derived from the rate, tax, and discount for this unit breakdown|Calculating the total for this unit breakdown based on its rate, tax, and discount|

### ResolvedLineItemTax
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|The unique identifier for this resolved line item tax|Derived from BookingFeePolicySnapshot and client input on Booking POST|Identifying this specific resolved line item tax|
|`rate`|Number|The tax rate for this resolved line item tax|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining the tax rate for this resolved line item tax|
|`amount`|Number|The tax amount for this resolved line item tax|Derived from the line subtotal and tax rate for this resolved line item tax|Calculating the tax amount for this resolved line item tax based on the line subtotal and tax rate|

### ResolvedLineItemDiscount
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|The unique identifier for this resolved line item discount|Derived from BookingFeePolicySnapshot and client input on Booking POST|Identifying this specific resolved line item discount|
|`rate?`|Number|The discount rate for this resolved line item discount|Derived from BookingFeePolicySnapshot and client input on Booking POST|Determining the discount rate for this resolved line item discount|
|`amount`|Number|The discount amount for this resolved line item discount|Derived from the line subtotal and discount rate for this resolved line item discount|Calculating the discount amount for this resolved line item discount based on the line subtotal and discount rate|


## ChangePolicySnapshot

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`rules`|[[ChangePolicyRule](#changepolicyrule)]|The snapshot of the change policy rules applied to this Booking at the time of booking|Derived from parent Product's referenced Change Policy at the time of booking|Capturing the specific change policy rules for this Booking based on the Product's Change Policy at the moment it was created|

## Example Booking

### Immediately after initialization

```json
--8<-- "datatypes/examples/booking1-init.json"
```

### After Finalization

```json
--8<-- "datatypes/examples/booking1-final.json"
```
