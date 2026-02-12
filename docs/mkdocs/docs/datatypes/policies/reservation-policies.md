# Reservation Policy

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`pk`|String|Partition key| "policy::\<policyType>::\<policyId>"|Searching all versions of this policy|
|`sk`|String|Sort key| "v\<policyIdVersion>" OR "latest" |Searching for a specific version of this policy|
|`gsipk`|String|Global secondary index partition key| Reserved | Reserved |
|`gsisk`|String|Global secondary index sort key| Reserved | Reserved |
| `schema`|String|Data type/Schema| "policy" |Identifying that this item is a "policy"|
|`globalId`|String|Globally unique UUID|Automatically generating on policy creation|Searching for this specific item using the `globalId` GSI|
|`policyType`|String|The type of policy| "reservation" |Searching for all policies of this type|
|`policyId`|String|A unique identifier for this policy, specific to the policy type|Automatically generating on policy creation|Searching for all versions of this specific policy|
|`policyIdVersion`|Number|The version number of this policy|Automatically incrementing on policy update|Searching for a specific version of this policy|
|`isLatest`|Boolean|Whether this is the latest version of the policy|Automatically setting on policy update|Searching for the latest version of this policy|
|`displayName`|String|A human-readable name for this policy|Provided on policy creation and update|Displaying this policy in a user interface|
|`description`|String|A human-readable description of this policy|Provided on policy creation and update|Displaying this policy in a user interface|
|`refStore`|[ReferenceStore](#referencestore)|The reference store that contains any additional data needed to evaluate this policy|Provided on policy creation and update|Accessing additional data needed to evaluate this policy|
|`productRules`|[ReservationProductRules](#reservationproductrules)|The rules that govern how this policy is applied at the Product level|Provided on policy creation and update|Evaluating whether a Product complies with the rules defined in this policy|
|`productDateRules`|[ReservationProductDateRules](#reservationproductdaterules)|The rules that govern how this policy is applied at the ProductDate level|Provided on policy creation and update|Evaluating whether a ProductDate complies with the rules defined in this policy|
|`createdAt`|Timestamp|The timestamp when this policy was created|Automatically setting on policy creation|Tracking when this policy was created|
|`lastUpdated`|Timestamp|The timestamp when this policy was last updated|Automatically updating on policy update|Tracking when this policy was last updated|

## ReferenceStore

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`user`|[ReferencePrimitive]|Reference primitives related to the user|User making the reservation|Evaluating policies that depend on user attributes|
|`inventory`|[ReferencePrimitive]|Reference primitives related to inventory|Inventory being reserved|Evaluating policies that depend on inventory attributes|
|`temporalAnchors`|[ReferencePrimitive]|Reference primitives related to temporal anchors (e.g., current date)|Current date and time|Evaluating policies that depend on temporal conditions|
|`temporalWindows`|[ReferencePrimitive]|Reference primitives related to temporal windows (e.g., discovery window, reservation window)|Current date and time, Product/ProducDate temporal window definitions|Evaluating policies that depend on whether the current date falls within certain temporal windows|
|`partyCategories`|[ReferencePrimitive]|Reference primitives related to party categories (e.g., adult, child, senior)|Composition of the party included in the reservation|Evaluating policies that depend on the composition of the party making the reservation|

## ReservationProductRules

These rules are scoped to entire Products/Bookings and are independent of when reservations occur. They answer the question: "What policies govern reservations of this offering, regardless of when they occur?"

These will be fully resolved on the Product.

Some policies may be abstract enough to be grouped into reusable modules across Products, while others may be specific enough to be defined singularly and exclusively to the Product. Reservation Policies aim to capture the former.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isDiscoverable`|Boolean|Is the Product discoverable? If yes, it can be returned in search results. If no, it will not be returned in search results.|Provided on policy creation and update|Evaluating whether a Product is discoverable based on this policy|
|`isReservable`|Boolean|Is the Product reservable? If yes, ProductDates can be queried. If no, it ProductDates cannot be queried and no reservations can be made.|Provided on policy creation and update|Evaluating whether a Product is reservable based on this policy|
|`minTotalDays`|Number|What is the minimum total number of days that must be included in a reservation of this Product?|Provided on policy creation and update|Evaluating whether a reservation meets the minimum total days requirement based on this policy|
|`maxTotalDays`|Number|What is the maximum total number of days that can be included in a reservation of this Product?|Provided on policy creation and update|Evaluating whether a reservation meets the maximum total days requirement based on this policy|
|`holdDuration`|Duration|How long can a reservation of this Product be held before it expires?|Provided on policy creation and update|Evaluating whether a reservation hold has expired based on this policy|
|`availabilityEstimationPattern`|AvailabilityEstimationPattern|What pattern governs how availability is estimated for ProductDates related to this Product?|Provided on policy creation and update|Determining how availability is estimated for ProductDates related to this Product based on this policy|
|`temporalWindows`|[ProductTemporalWindows](#producttemporalwindows)|The temporal windows that govern when this Product is discoverable and reservable|Provided on policy creation and update|Evaluating whether a Product is discoverable and reservable based on the current date and the temporal windows defined in this policy|

### ProductTemporalWindows

Below are the mandatory temporal windows that must be defined for a reservation policy. Additional temporal windows can be added as needed.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`discoveryWindow`|TemporalWindow|If the Product is discoverable, what is the temporal window for which it should be discoverable?|Provided on policy creation and update|Evaluating whether a Product is discoverable based on the current date and the discovery window defined in this policy|

## ReservationProductDateRules

These rules are scoped to ProductDates/BookingDates and can change day-to-day. They answer the question: "What policies that govern reservations of this offering depend on when when a particular action occur?"

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isDiscoverable`|Boolean|Is the ProductDate discoverable? If yes, it can be returned in search results. If no, it will not be returned in search results.|Provided on policy creation and update|Evaluating whether a ProductDate is discoverable based on this policy|
|`isReservable`|Boolean|Is the ProductDate reservable? If yes, reservations can be made for that date. If no, reservations cannot be made for that date.|Provided on policy creation and update|Evaluating whether a ProductDate is reservable based on this policy|
|`minDailyInventory`|Number|What is the minimum Inventory quanitity that Bookings must reserve for this ProductDate?|Provided on policy creation and update|Evaluating whether a reservation meets the minimum daily inventory requirement based on this policy|
|`maxDailyInventory`|Number|What is the maximum Inventory quanitity that can be reserved for this ProductDate?|Provided on policy creation and update|Evaluating whether a reservation meets the maximum daily inventory requirement based on this policy|
|`temporalWindows`|[ProductDateTemporalWindows](#productdatetemporalwindows)|The temporal windows that govern when this ProductDate is discoverable and reservable|Provided on policy creation and update|Evaluating whether a ProductDate is discoverable and reservable based on the current date and the temporal windows defined in this policy|

### ProductDateTemporalWindows

Below are the mandatory temporal windows that must be defined for a reservation policy. Additional temporal windows can be added as needed.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`discoveryWindow`|TemporalWindow|If the ProductDate is discoverable, what is the temporal window for which it should be discoverable?|Provided on policy creation and update|Evaluating whether a ProductDate is discoverable based on the current date and the discovery window defined in this policy|
|`reservationWindow`|TemporalWindow|What is the temporal window for which reservations can be made for this ProductDate?|Provided on policy creation and update|Evaluating whether reservations can be made for this ProductDate based on the current date and the reservation window defined in this policy|
|`restrictedBookingWindow`|TemporalWindow|What is the temporal window for which bookings of this ProductDate are final-sale?|Provided on policy creation and update|Evaluating whether bookings of this ProductDate are final-sale based on the current date and the restricted booking window defined in this policy|

