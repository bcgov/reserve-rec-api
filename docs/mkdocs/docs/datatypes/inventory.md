# Inventory

Inventory represents the most granular, indivisible unit of an offering. It is the smallest unit of availability that can be claimed by exactly one user at a time.

It always corresponds to:
- A specific date (e.g., May 1, 2026)
- A specific Asset (e.g., Campsite A)

This makes Inventory the foundation of the reservation system's concurrency model.

## Types of Inventory

Inventory comes in two forms, _fixed_ and _flex_, inherited from the Asset they represent. This distinction determines how the basic rules of how Inventory is allocated and reserved.

### Fixed Inventory

Fixed Inventory corresponds to Assets that have a fixed, inflexible limit of discrete units. Fixed Inventory typically refers to a specific physical Asset (e.g. Campsite A). If a user's Booking covers multiple days, they will be allocated multiple units of Inventory, but in the case of a fixed Asset, each Inventory unit _must_ correspond to the same Asset (e.g. Campsite A on May 1, 2026, Campsite A on May 2, 2026, etc.). Pools of fixed Inventory can represent many Assets per day, but must have at most one unit of Inventory per Asset per date.

### Flex Inventory

Flex Inventory corresponds to Assets that have a flexible limit of units that can be allocated. Flex Inventory typically refers to conceptual Assets (e.g., "trail passes"). There is no requirement that multiple units of Flex Inventory allocated to a single Booking correspond to the same Asset. For example, if a user's Booking covers multiple days, they may be allocated different units of Flex Inventory for each day (e.g., Trail Pass for May 1, 2026, Trail Pass for May 2, 2026, etc.). Pools of flex Inventory can represent at most one Asset per day, but can have many units of Inventory per Asset per date.

A Booking may have multiple units of Inventory allocated to it, but all units of Inventory allocated to a single Booking must refer to the same Asset. This means that a Booking cannot be allocated both fixed and flex Inventory, since they correspond to different Assets.

## Inventory Lifecycle

Inventory provides the clearest, most accurate representation of availability for a Product on a specific date. Any availability check, whether for a single date or an entire season, ultimately depends on the state of the underlying Inventory.

Products and ProductDates, configured by system administrators, define the operational scaffolding from which Inventory is generated. Administrators determine how far into the future they want the system to support Bookings, configure the Product and ProductDates accordingly, and then run a generation script that seeds Inventory for that window.

Ideally, this generation process occurs well before the public begins browsing or reserving, and is rarely, if ever, re-run. Without pre‑seeded Inventory, the system has nothing to allocate, and users may encounter gaps or degraded functionality.

Determining how far into the future to seed Inventory is a balance between operational overhead and user experience. Seeding too little Inventory means more frequent generation, which can be operationally burdensome and may introduce availability gaps if not managed carefully. Seeding too much Inventory may lead to wasted resources if Products or ProductDates change their operational details, necessitating Inventory adjustments.

Inventory acts as the allocation state machine for the system. Inventory can occupy the following states:

- **Available** - This Inventory unit is available to be reserved by users. It has not yet been claimed by any user, and can be allocated to a Booking if the user meets all necessary requirements.
- **Held** - This Inventory unit has been claimed by a user and allocated to their Booking. It is no longer available for other users to reserve, but the user has not yet completed the booking process (e.g., payment).
- **Reserved** - This Inventory unit has been claimed by a user, allocated to their Booking, and the user has completed the booking process (e.g., payment). It is no longer available for other users to reserve.
- **Releasing** - This Inventory unit was previously reserved, but is now in the process of being returned or exchanged by the user. For validation purposes, the Inventory cannot be considered part of the user's active reservation anymore, but also cannot yet be made available to other users until the release process is complete, in case the return fails.

The phases of this state machine are:

- **Seeding**
- **Discovery and Alignment**
- **Commitment**
- **Retirement**

## Seeding

Inventory is generated through a seeding process that creates Inventory units based on the configuration of Products and ProductDates. This process is typically run by administrators and should occur well before users begin browsing or reserving, and involves iterating through the configured Products and ProductDates, determining the corresponding Assets, and creating Inventory units for each combination of ProductDate and Asset according to the allocation type (fixed or flex). Each Inventory unit is initialized with the appropriate properties, such as allocation status (initially Available), references to the corresponding ProductDate and Asset, and a unique identifier. After seeding, the Inventory is ready to be allocated to users as they make reservations - but its discoverablity and allocability will depend on the specific configuration of the Product and ProductDate it corresponds to.

## Discovery and Alignment

Users discover Inventory through the offerings presented to them as they browse, however, users only interact directly with Inventory when they request to claim it. Before requesting, ProductDates ensure the user is informed regarding what Inventory they are requesting and the estimated availability of that Inventory. When a user makes a request to claim Inventory, the system checks for Available Inventory that matches the user's desired Product and date(s), and if the user meets all necessary requirements, transitions the Inventory to Held, instantiates a Booking and allocates the Inventory to that Booking.

From the Held state, the user can complete the reservation process, which transitions the Inventory to Reserved. If the user fails to complete the reservation process within a certain timeframe, or if they abandon their reservation, the Inventory can be transitioned back to Available, making it discoverable and allocable to other users again.

## Commitment

When a user completes the reservation process (e.g., payment), the system transitions the allocated Inventory from Held to Reserved, marking it as officially claimed by the user. It will remain in this state forever, or until the user initiates a return or exchange, at which point it will transition to Releasing.

## Retirement

If the Inventory is unclaimed and the date associated with the Inventory passes, or the Asset it corresponds to is decommissioned, or if any of the underlying Product or ProductDate configurations change in a way that invalidates the Inventory, it is retired. Retiring Inventory typically involves scuttling it, removing it from the system, or marking it as inactive, ensuring it is no longer available for reservation.

## Returning Inventory to the Availability Pool

Every time Inventory transitions back to Available, it must be validated to ensure it can be returned to the availability pool. This involves checking that the Inventory's date has not yet passed, that the corresponding Asset is still active, and that the underlying Product and ProductDate configurations have not changed. If any of these checks fail, the Inventory cannot be returned to the availability pool, and must instead be retired.

Inventory that has been 'spent', that is, reserved and then used (e.g., the user checked in to their campsite on the reserved date), is implicitly retired, as it cannot be returned to the availability pool.

## Reseeding

Sometimes the governing strucutre of a Product or ProductDate changes after Inventory has already been seeded. For example, the Asset that a ProductDate references may change, or the allocation type of that Asset may change, which would invalidate the existing Inventory. In these cases, the affected Available Inventory must be scuttled and re-seeded according to the new configuration. Fully allocated Inventory (Reserved) must remain untouched, so re-seeding processes must this in. This process is operationally intensive and can lead to availability gaps if not managed carefully.

# Properties

## Inventory

As Inventory's primary purpose is concurrency control, it has relatively few properties. Policies governing how Inventory is allocated and reserved are defined at the Product and ProductDate level, but Inventory itself only has properties that are necessary for reference and for enforcing concurrency.

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`pk`|String|Partition key |"inventory::\<collectionId>::\<activityType>::\<activityId>::\<productId>::\<date>"|Identifying the Inventory pool for a specific Product on a specific date|
|`sk`|String|Sort key|"asset::\<collectionId>::\<facilityType>::\<facilityId>::\<assetType>::\<assetId>::\<inventoryId>"|Identifying the specific Asset within the Inventory pool|
|`gsipk`|String|Global secondary index partition key|Reserved|Reserved|
|`gsisk`|String|Global secondary index sort key|Reserved|Reserved|
| `schema`|String|Data type/Schema| "inventory" |Identifying that this item is "inventory"|
| `globalId`| String|Globally unique UUID|Automatically generating on Inventory seed| Searching for this specific item using the `globalId` GSI
|`inventoryId`|String|Unique identifier for the Inventory unit (for fixed inventory this will always be 1)|Auto-generated on Inventory seed|Distinguishing this Inventory unit from others in the same pool (fixed assets inherently do this already, but flex assets do not)|
|`allocationType`|String|The allocation type of this Inventory unit, either "fixed" or "flex"|Referenced Asset|Determining how this Inventory unit can be allocated|
|`assetRef`|PrimaryKey|Reference to the Asset that this Inventory unit corresponds to|Referenced Asset|Identifying which Asset this Inventory unit is associated with|
|`assetVersion`|String|The version of the Asset at the time this Inventory unit was seeded|Referenced Asset|Ensuring consistency between the Inventory unit and the Asset it is associated with|
|`date`|Date|The calendar date that this Inventory unit is available for reservation|Referenced ProductDate|Identifying which date this Inventory unit is associated with|
|`productDateRef`|PrimaryKey|Reference to the ProductDate that this Inventory unit is available for reservation|Referenced ProductDate|Identifying which ProductDate this Inventory unit is associated with|
|`productDateVersion`|String|The version of the ProductDate at the time this Inventory unit was seeded|Referenced ProductDate|Ensuring consistency between the Inventory unit and the ProductDate it is associated with|
|`allocationStatus`|String|The allocation status of this Inventory unit, either "available", "reserved", "held", "releasing"|Current Inventory allocation state|Determining whether this unit is available to be reserved, or already claimed|
|`createdAt`|Timestamp|The timestamp when this Inventory unit was created|Automatically generating on Inventory seed|Tracking when this Inventory unit was created|

## Example

```json
--8<-- "datatypes/examples/inventory1.json"
```

