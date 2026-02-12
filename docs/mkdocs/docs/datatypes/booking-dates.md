# BookingDate

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`pk`|String|Partition key| "bookingDate::\<bookingId>"|Constructing the primary key for this BookingDate based on its associated Booking|
|`sk`|String|Sort key| "\<date>"|Constructing the sort key for this BookingDate based on its date|
|`gsi1pk`|String|Global secondary index partition key| Reserved|Reserved|
|`gsi1sk`|String|Global secondary index sort key| Reserved|Reserved|
|`schema`|String|Data type/Schema| "bookingDate" |Identifying that this item is a "bookingDate"|
|`globalId`|String|Globally unique UUID|Automatically generating on BookingDate creation|Ensuring that each BookingDate has a unique identifier|
|`bookingId`|String|The ID of the Booking this BookingDate is associated with|Derived from the parent Booking's ID|Linking this BookingDate to its parent Booking|
|`user`|String|The user sub of the customer who made the Booking|Derived from the parent Booking's customer information|Associating this BookingDate with the user who made the booking for access control and querying purposes|
|`date`|Date|The specific date this BookingDate represents|Derived from the reservation details of the Booking|Identifying which date this BookingDate corresponds to within the Booking's itinerary|
|`inventory`|[PrimaryKey]| The specific inventory items that are reserved for this date|Derived from the reservation details of the Booking|Specifying which inventory items are allocated for this BookingDate based on the reservations made in the Booking|
|`reservationSnapshot`|[BookingDateReservationSnapshot](#bookingdatereservationsnapshot)| The snapshot of the reservation details for this date at the time of booking|Derived from the reservations made in the Booking for this date|Capturing the specific reservation details for this date based on the Booking's reservations at the moment it was created|
|`reservationValues`|[BookingDateReservationValues](#bookingdatereservationvalue)| The snapshot of the reservation values for this date at the time of booking|Derived from the reservations made in the Booking for this date|Capturing the specific reservation values for this date based on the Booking's reservations at the moment it was created|
|`partyValues`|[BookingDatePartyValues](#bookingdatepartyvalues)| The snapshot of the party composition values for this date at the time of booking|Derived from the reservations made in the Booking for this date|Capturing the specific party composition values for this date based on the Booking's reservations at the moment it was created|
|`feePolicySnapshot`|[BookingDateFeePolicySnapshot](#bookingdatefeepolicysnapshot)| The snapshot of the fee policy details for this date at the time of booking|Derived from the parent Product's referenced Fee Policy at the time of booking|Capturing the specific fee policy details for this date based on the Product's Fee Policy at the moment it was created|`
|`feeValues`|[BookingDateFeeValues](#bookingdatefeevalues)| The snapshot of the fee values for this date at the time of booking|Derived from the fee policy details and reservation details for this date|Capturing the specific fee values for this date based on the fee policy and reservation details at the moment it was created|

## BookingDateReservationSnapshot

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isDiscoverable`|Boolean|Was the reservation for this date discoverable?|Derived from the ProductDate's `isDiscoverable` value|Determining if the reservation for this date was discoverable at the time of booking|
|`isReservable`|Boolean|Was the reservation for this date reservable?|Derived from the ProductDate's `isReservable` value|Determining if the reservation for this date was reservable at the time of booking|
|`minDailyInventory`|Number|What was the minimum daily inventory allowed for this date?|Derived from the ProductDate's `minDailyInventory` value|Capturing the minimum daily inventory for this date at the time of booking|
|`maxDailyInventory`|Number|What was the maximum daily inventory allowed for this date?|Derived from the ProductDate's `maxDailyInventory` value|Capturing the maximum daily inventory for this date at the time of booking|
|`temporalAnchors`|[BookingDateResolvedTemporalAnchors](#bookingdateresolvedtemporalanchors)|What were the temporal anchors for this date?|Derived from the ProductDate's `temporalWindows` values|Capturing the temporal anchors for this date at the time of booking|
|`temporalWindows`|[BookingDateResolvedTemporalWindows](#bookingdateresolvedtemporalwindows)|What were the temporal windows for this date?|Derived from the ProductDate's `temporalWindows` values|Capturing the temporal windows for this date at the time of booking|

### BookingDateResolvedTemporalAnchors

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`checkInAnchor`|Timestamp|What was the check-in temporal anchor for this date?|Derived from the ProductDate's `temporalWindows` values|Capturing the check-in temporal anchor for this date at the time of booking|
|`checkOutAnchor`|Timestamp|What was the check-out temporal anchor for this date?|Derived from the ProductDate's `temporalWindows` values|Capturing the check-out temporal anchor for this date at the time of booking|
|`noShowAnchor`|Timestamp|What was the no-show temporal anchor for this date?|Derived from the ProductDate's `temporalWindows` values|Capturing the no-show temporal anchor for this date at the time of booking|

### BookingDateResolvedTemporalWindows
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`discoveryWindow`|TemporalWindow|What was the discovery temporal window for this date?|Derived from the ProductDate's `temporalWindows.discoveryWindow` value|Capturing the discovery temporal window for this date at the time of booking|
|`reservationWindow`|TemporalWindow|What was the reservation temporal window for this date?||Derived from the ProductDate's `temporalWindows.reservationWindow` value|Capturing the reservation temporal window for this date at the time of booking|
|`restrictedBookingWindow`|TemporalWindow|What was the restricted booking temporal window for this date?|Derived from the ProductDate's `temporalWindows.restrictedBookingWindow` value|Capturing the restricted booking temporal window for this date at the time of booking|

## BookingDateReservationValues
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`totalInventory`|Number|The inventory count on this date|The quantity of inventory items reserved for this date||Capturing the total inventory for this date based on the reservations made in the Booking|

## PartyValues

Note that the party policy and all party composition rules are defined at the Product/Booking level and do not vary day to day, so the BookingDate does not need to capture a party policy snapshot. However, the actual party composition values can vary day to day based on the reservations made in the Booking, so those values are captured here.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isValid`|Boolean|Is the party composition for this date valid based on the Product's party composition rules?|Derived from evaluating the party composition for this date against the Product's party composition rules|Determining if the party composition for this date is valid at the time of booking|
|`partyComposition`|[BookingDatePartyComposition](#bookingdatepartycomposition)|The specific party composition for this date|Derived from the reservations made in the Booking for this date|Capturing the specific party composition for this date based on the reservations made in the Booking at the moment it was created|

### BookingDatePartyComposition
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`id`|String|The identifier for this type of party member or equipment|Derived from the Product's party composition rules|Identifying the type of party member or equipment based on the Product's party composition rules|
|`label`|String|The label for this type of party member or equipment|Derived from the Product's party composition rules|Providing a human-readable label for this type of party member or equipment based on the Product's party composition rules|
|`quantity`|Number|The count of this type of party member or equipment for this date|Derived from the reservations made in the Booking for this date|Capturing the count of this type of party member or equipment for this date based on the reservations made in the Booking at the moment it was created|

## BookingDateFeePolicySnapshot
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`feeSchedule`|[FeeSchedule](#feeschedule)|The fee schedule that applies to this date|Derived from the parent Product's referenced Fee Policy at the time of booking|Capturing the fee schedule for this date based on the Product's Fee Policy at the moment it was created|
|`lineItems`|[LineItem](#lineitem)|The fee policy line items that apply to this date|Derived from the parent Product's referenced Fee Policy at the time of booking|Capturing the fee policy line items for this date based on the Product's Fee Policy at the moment it was created|

## BookingDateFeeValues
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`resolvedLineItems`|[ResolvedLineItem](#resolvedlineitem)|The resolved fee line items for this Booking|Derived from BookingFeePolicySnapshot and client input on Booking POST|Capturing the specific fee line items for this Booking based on the fee policy snapshot and customer input|
|`totalDiscounts`|[[ResolvedLineItemDiscount](#resolvedlineitemdiscount)]|The total amount of discounts applied to this BookingDate|Derived from the resolved line items for this BookingDate|Calculating the total discounts for this BookingDate based on the resolved fee line items|
|`totalTaxes`|[[ResolvedLineItemTax](#resolvedlineitemtax)]|The total amount of taxes applied to this BookingDate|Derived from the resolved line items for this BookingDate|Calculating the total taxes for this BookingDate based on the resolved fee line items|
|`subTotal`|Number|The subtotal amount for this BookingDate before taxes|Derived from the resolved line items for this BookingDate|Calculating the subtotal for this BookingDate based on the resolved fee line items|
|`total`|Number|The total amount for this BookingDate after applying taxes and discounts|Derived from the resolved line items for this BookingDate|Calculating the total for this BookingDate based on the resolved fee line items, including taxes and discounts|

## Example BookingDate

### Immediately after Booking Creation (initialization)
```json
--8<-- "datatypes/examples/booking-date1-init.json"
```

### After Booking Finalization
```json
--8<-- "datatypes/examples/booking-date1-final.json"
```