# Public User Journey Phases

Public visitors must be able to navigate the reservation system intuitively, without needing deep knowledge of the underlying data model. Most user journeys follow three distinct phases of interaction.

- [Discovery](#discovery-phase)
- [Alignment](#alignment-phase)
- [Commitment](#commitment-phase)

Public visitors move through these phases as personal user journeys.

## Discovery Phase

The Discovery Phase is where users begin their journey, typically by arriving on a public‑facing landing page. At this point, the system cannot assume any level of familiarity.

Users may have
- **Extensive system knowledge** "I know what I am looking for and I know how to find it."
- **No system knowledge** "I am not sure what I am looking for or how to start looking for it."
- **Anything in between** A partial understanding of the system and its capabilities.

Because of this wide range of familiarity, the system must introduce itself clearly to newcomers while still allowing experienced users to move quickly. The Discovery Phase is designed to support both: it exposes the breadth of what the system can do while enabling direct navigation for those who already know their path.

### Ideal Discovery Flow

The data model is optimized to resolve user intent in the following order:

**where** -> **what** -> **when**

This order was chosen because:
- Users often begin with a place in mind, even if vague.
- Activities (intent) become meaningful only once anchored to a location.
- Temporal context (availability, pricing, policies) can only be resolved once the offering is known

### How the Data Model Currently Supports Discovery

With the help of [OpenSearch](../data-model/data-storage.md#opensearch-partitioning), the system currently supports full text searching. By using the `searchTerms` property on geozones, facilities, and activities, searching for a shared term among several datatypes will return them in a query.

Example: If a user enters 'Bedwell', they should be returned a list of geozones, facilities and activities that relate to the Bedwell Lake Area in Strathcona Park

### How a Future Data Model State Might Bolster Discovery

#### [Relationship Schemas](../contexts/data-categorization.md#relational-data-future-state)

Geozones, facilities, and activities form a graph‑shaped network of two-way-linked, many‑to-many relationships. Because DynamoDB does not support joins, and foreign keys become complicated to manage as the system scales, these relationships should be represented explicitly as relationship items.

A relationship item stores a single edge in the graph.
The `pk`/`sk` pair provides the forward lookup, and a GSI provides the reverse lookup, enabling efficient two‑way navigation between domain objects.
This pattern is the standard NoSQL approach for modeling many‑to‑many relationships.


Example: The Bedwell Lakes Backcountry Camping Activity is two-way-linked to the Bedwell Lakes Trail Area Geozone. A potential relationship data item that conveys this link might look like the following JSON example:
```json
{
  "pk": "rel::activity::bcparks_1::backcountryCamp::1"           // Forward query pk = the compound primary key of the first item, separated by '::'
  "sk": "geozone::bcparks_1::2"                                  // Forward query sk = the compound primary key of the second item, separated by '::'
  "schema": "relationship",
  "schema1": "activity",                                         // The schema of the first item
  "schema2": "geozone",                                          // The schema of the second item
  "pk1": "activity::bcparks_1",                                  // The pk of the first item (optional)
  "pk2": "geozone::bcparks_1",                                   // The pk of the second item (optional)
  "sk1": "backcountryCamp::1",                                   // The sk of the first item (optional)
  "sk2": "2",                                                    // The sk of the second item (optional)
  "gsipk": "rel::geozone::bcparks_1::2",                         // Reverse query pk = the compound primary key of the second item, separated by '::' (GSI partition key)
  "gsisk": "activity::bcparks_1::backcountryCamp::1"             // Reverse query sk = the compound primary key of the first item, separated by '::' (GSI sort key)
}
```

This relationship schema provides a separation of duties, and keeps geozones, facilities, and activities truly within their respective spatial and intent contexts.

Questions that this future state can help answer:

- **"I know where I want to go**, but I dont know what's available or when"
   - Navigate to a geozone or facility and see the activities associated with the location.
- **"I know what I want to do, and I have a vague idea of where I want to go**, but I don't know exactly where it's available or when"
   - Search by activity -> shows activityType and the geozones and facilities where it is offered.

#### Search by ActivityType

Activities include both an activityType (the generalized experience) and a location‑scoped identity that distinguishes where that experience occurs. For example, Backcountry Camping in Strathcona Park and Backcountry Camping in E.C. Manning Park share the same activityType but occur in vastly different locations, and are therefore represented by different activities.

Some visitors may begin their journey with a clear sense of what they want to do, but little or no preference for where it happens. Searching by activityType supports this intent, but because there are only a small number of activityTypes, a query at this level can return a very large set of results.

Questions this future state can help answer:

- **"I know what I want to do**, but I don't know when it's available, and I don't care where"
   - Without any spatial narrowing, a broad activityType (e.g., “backcountry camping”) may return hundreds of results across the province. Many of these results will not be meaningful to the user, who likely has implicit geographic constraints (travel distance, region, familiarity).

This query is still technically supportable, but the system should encourage users to provide at least a general sense of place to avoid overwhelming or irrelevant results.

#### Date-First Querying

None of the Discovery Phase schemas include **temporal** context. This makes the question:

- **"I know when I want to go**, but I don't know where or what I want to do"

...difficult to answer at this stage. Supporting this journey would require live availability indexing across the entire system - something only possible once the operational data model is fully stable. This makes it a strong candidate for future enhancement rather than a core Discovery Phase feature.

## Alignment Phase

Once users understand *what* exists - the places, facilities and activities available in the system - they move into the **Alignment Phase**, where the system begins translating their interests into concrete, reservable offerings. This is the moment where intent meets operational reality.

In this phase, users shift from broad exploration to evaluating specific options. They are no longer asking "What can I do?" but rather:

- **"What does BC Parks offer that matches what I want?"**
- **"When is it available?"**
- **"What rules or constraints apply?"**

The Alignment Phase is where the system resolves these questions by mapping user intent to actual, date-specific offerings.


These schemas introduce the **temporal** and **governance** contexts absent in the Discovery Phase. Together, they form the bridge between high-level exploration and concrete booking options. Regardless of how users arrived from the Discovery Phase, the Alignment Phase answers:

- **"I see what they've got in relation to what I want"**

... and ensures the user is looking at **valid, operationally grounded choices**.

The following steps are typical in the Alignment Phase:

#### Visitors Make Reservation Request

When a visitor decides to make a reservation for a Product, they submit a reservation request. Depending on the structure of the Product, the visitor may be prompted to provide:

- A date or list of continuous dates they wish to reserve.
- The quantity of each Asset they wish to reserver on each date.
  - Some Products may allow a maximum of 1 Inventory item per date (e.g. offerings for a campsite). In these cases, the reservation request would only prompt for a date or list of continuous dates, and the system would assume a quantity of 1 for each date.
  - Some Products may allow multiple Inventory items per date (e.g. trail passes) but may only allow 1 date per reservation. In these cases, the reservation request would prompt for a date and the quantity of each Asset they wish to reserve for that date.
  - Some Products may allow multiple Inventory items per date, and multiple dates per reservation (e.g. backcountry reservations may allow this?).

The system validates the reservation request against the reservation policies defined on the Product and ProductDate items, as well as the availability of the items by verifying available Inventory items. If the reservation request is valid and there is sufficient availability, the system creates a Booking and related BookingDates for the visitor and updates the relevant Inventory and AvailabilitySignal items to reflect the new reservation.

- Visitor's request timestamp is recorded and validated against `isReservable` and the `temporalWindows.reservationWindow` defined on each ProductDate included in the reservation request.
- The reservation request is validated against the `minTotalDays` and `maxTotalDays` defined on the Product reservation policy.
- Visitor's `arrivalDate` and `departureDate` are recorded.
- The `checkInAnchor` and `noShowAnchor` are determined based on the visitor's `arrivalDate` and the Product's timezone.
- THe `checkOutAnchor` is determined based on the visitor's `departureDate` and the Product's timezone.
- The reservation request is validated against any `allDatesReservedIntervals` defined on the Product.
- A BookingDate is created for each date included in the reservation request.
- Each Inventory item requested is recorded and validated against the `minDailyInventory` and `maxDailyInventory` defined on each ProductDate included in the reservation request. Each BookingDate records the specific Inventory items reserved for that date.
- The reservation request is inspected to see if any `restrictedBookingWindow` defined on any ProductDate included in the reservation request is triggered. If so, the reservation is marked as final-sale.

#### Visitors Enhance Alignment with Additional Context

Once a Booking has been initialized, visitors can make changes that do not affect Inventory allocation before finalizing the reservation. This changes may include:

- Visitors add or remove party members if it does not impact Inventory allocation
- Visitors add or remove equipment if it does not impact Inventory allocation
- Visitors update contact information
- Visitors apply discount codes or vouchers

These changes are validated against the booking policies defined on the Product and ProductDate items, and the Booking and related BookingDates are updated accordingly. They may influence fees applied to the reservation, but do not require re-validation of availability or Inventory allocation.

Changes that impact Inventory allocation incur a re-validation of the reservation request against availability and reservation policies. Early iterations may not support these changes pre-finalization, and may require visitors to cancel and rebook if they wish to make such changes. These changes may include:

- Visitors changing dates of the reservation
- Visitors changing quantity of Assets reserved
- Visitors lengthening or shortening the reservation
- Visitors changing party composition that impacts Inventory allocation
- Visitors changing equipment that impacts Inventory allocation

## Commitment Phase

Once public users have identified a specific offering that aligns with their intent, they enter the **Commitment Phase**. This is where the system formalizes the user's choice by allocating inventory, applying policies, and completing financial transactions. It is the moment where a user's interest becomes an operational obligation.

In this phase, the system must ensure that
- The inventory being claimed is valid and unambiguously owned
- The governing rules are correctly applied
- The user's identity and party details are captured
- Financial transactions, if any, are processed
- The booking is recorded in a durable, auditable form

Schemas that support the Commitment Phase are

- Bookings
- Users
- Transactions
- Policies

Regardless of path, the Commitment Phase answers:

- **"I've got what I want - or the closest available option - and I am ready to commit".**

This phase transforms the user's journey from exploration and evaluation into a legally and operationally binding commitment.

The Commitment Phase is the most operationally sensitive part of the user journey, where concurrency, policy enforcement, and financial correctness must all converge.

