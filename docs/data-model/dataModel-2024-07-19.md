# Data Model
Written: 2024-07-19 
Author: Team Osprey

Team Osprey is endeavouring to determine a Minimum Viable Dataset for the backcountry reservation component of the PRDT Project. This document is a first pass at that MVD and is intended to be iterated on. 

### Goal
The goal of this document is to outline the datapoints that will most likely be necessary to move forward with the backcountry reservation component. If the new reservation wishes to support a certain 'experience', _ie_ allowing users to reserve a tentpad in the Garibaldi backcountry, then the experience must satisfy all mandatory datapoints of the MVD.

## Minimum Viable Dataset
The MVD is the scope of data that encompasses the minimum amount of information necessary to provide the same or greater level of service than the existing system on an experience-by-experience bases. The data that the MVD contains are prime candidates for storage in a data registry, in that they do not change frequently, are largely time-independent, contain no personally identifying information and are referenced by potentially many different consumers. Some categories of data in the MVD are:

* Inventory
* Permits
* Policies
* Operating Schedules
* Places
  
### MVD Data Hierarchy
![image](https://github.com/user-attachments/assets/3ae5b2db-4325-429d-b4ac-8b0a0df54e2d)


## Property Types
Below is a table of the data types used in the MVD to enforce uniform data representation across all datapoints. 

|**Property Type**|**Description**|
|---|---|
|`String`|Primitive type|
|`Number`|Primitive type|
|`Boolean`|Primitive Type|
|`DateTime`|Full ISO timestamp|
|`Date`|Calendar date presented as an object, eg: `{year: 2024, month: 7, day: 18}`|
|`ISODate`|Calendar date presented as `YYYY-MM-DD`|
|`Time`|Time of day in 24h time, presented as an object, eg: `{hour: 12, minute: 30, second: 0}`|
|`Duration`|A non-specific, continuous span of time, presented as an object, eg: `{days: 14}`|
|`Interval`|A specific, continuous span of time with a start and end bound by `DateTimes`|
|[`propertyType`]|An array of `propertyType`|
|`Enum`|Enumerator - Special type that denotes a group of unchanging values|
|`GeoJSON`|Valid geoJSON. See https://geojson.org/|
|`Primary Key`|DynamoDB primary key; either single key or combination partition and sort keys|
|`URL`|A `String` URL|

### Base Data Properties
All datatypes in the MVD shall stem from the following base datatype, which primarily contains metadata.
|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|pk|`String`|DynamoDB Partition Key|Y|
|sk|`String`|DynamoDB Sort Key|Y|
|name|`String`|The name used to identify the data|Y|
|description|`String`|A description of the data|N|
|version|`Number`|Version of the data|Y|
|creationDate|`DateTime`|Date of initial data creation|Y|
|lastUpdated|`DateTime`|Date of most recent versioning|Y|
|category|`String` or `Enum`|The category of data, eg [place](#places) or [inventory](#inventory)|Y|
|type|`String` or `Enum`|Name of the specific datatype, eg 'park' or 'tentpad'|Y|
|images|`URL`|A URL linking to a storage location for images|N|
|icon|`URL`|A URL linking to a storage location for an icon|N|
|identifier|`String` or `Number`|A `String` or `Number` that can be used to uniquely identify the datapoint within a group of its immediate peers|Y|


## Inventory
Inventory refers to a BC Parks asset provided for camper use. It is the most granular item or offering provided by BC Parks. They are typically physical resources but may also pertain to intangible items like a backcountry registration permit or ‘passport’, which only provides permission for a user to enter the backcountry but does not include any physical reservations. Inventory may be limited/finite, as is the case with tentpads, or unlimited/infinite, as is the case with some backcountry registration permits/passports. Inventory that can be reserved by users may only be held by at most one user at a time. Some inventory may also have geospatial properties. If ownership of the inventory must be tracked, such as in the case of reservations, then the inventory can belong to a [**permit**](#permits_) that will govern how it is allotted to campers.

Some quick examples of inventory are:

* a single, specific tentpad 
* permission to enter the backcountry at a specific location
* a bunk in a shelter
* a food cache or outhouse

### Inventory Data Properties
All permits inherit the properties from [base data type](#base-data-properties).
|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|location|`GeoJSON`|Valid geoJSON (geopoint) describing the geospatial features of the inventory|N|
|timezone|`String`|The IANA string timezone identifier of the timezone within which the inventory exists*|Y|
|mapZoom|`Number`|Zoom level at which the item appears on a map|N|
|isFinite|`Boolean`|Whether or not the inventory belongs to a finite set|Y|
|isReservable|`Boolean`|Whether or not the inventory is reservable|Y|
|parentPermit|`Permit`|The permit that handles the allocation of the inventory. See [**permits**](#permits)|N|
|parentPlace|`Place`|The place where the inventory is located|Y|
|inventoryId|`Number`|Like identifier - a number that uniquely distinguishes the inventory from other inventory of the same type in the same place|Y|
|siteName|`String`|The name of the parent place|N|
|orcs|`Number`|The orcs of the parent park|N|
|dataSource|`String`|Where the information on the inventory was obtained (meta)|N|
|cwAssetId|`Number`|CityWide Asset Id|N|

Example Inventory pk/sk (For tentpad #1, campground #5 (Little Kuitshe Creek Campground), orcs #9398 (Juan de Fuca)
```
pk: inventory::9398::campground::5
sk: tentpad::1
```

*Likely inherited from the inventory's parent place.

BC has [3 timezones](https://en.wikipedia.org/wiki/Time_in_Canada#/media/File:Canada_time_zone_map_-_en.svg):
|**Abbreviation**|**IANA String**|
|---|---|
|`PST/PDT`|`America/Vancouver`|
|`MST/MDT`|`America/Edmonton`|
|`MST`|`America/Fort_Nelson`|

## Permits
A permit is a physical or digital document that gives someone permission to do something or be somewhere at a certain time. It may additionally permit someone to use BC Parks [**inventory**](#inventory) during that time, possibly exclusively. They exist to give BC Parks a record of who has permission to do something or be somewhere or use which inventory at some point in time. They link specific users to specific inventory. 

Permits are created from configuration templates governed by [**policies**](#policies), which dictate when the permission is available to someone, how much permission costs, and other information. Each configuration template has an **operating schedule** and also belongs to a [**place**](#places).

Some examples of permits include:

 - A backcountry reservation for 2 tentpads for 2 specific nights at a specific location
 - A backcountry registration permit for 3 specific nights permission to stay in the backcountry of a specific park
 - A day-use pass for a specific day to a specific location

### Permit (config) Data Properties

All permits inherit the properties from [base data type](#base-data-properties).
|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|operatingSchedule|`OperatingSchedule`|The schedule of operation for the permit. See [operating schedule](#operating-schedule)|Y|
|parentPlace|`Place`|The place that the permit is issued for|Y|
|bookingPolicy| `BookingPolicy`|The permit's governing booking policy. See [booking policy](#booking-policy)|Y|
|changePolicy| `ChangePolicy`|The permit's governing change policy. See [change policy](#change-policy)|Y|
|feePolicy| `FeePolicy`|The permit's governing fee policy. See [fee policy](#fee-policy)|Y|
|partyPolicy| `PartyPolicy`|The permit's governing party policy. See [party policy](#party-policy)|Y|
|isInventoryFinite|`Boolean`|Whether or not the inventory is part of a limited set|Y|
|permitType|`String`|Permit type.|Y|
|permitId|`Number`|Like identifier - a number that uniquely distinguishes the permit from other permits of the same type at the same place|Y|
|inventory|`[Inventory]`|A list of inventory keys that are controlled by the permit|N|

Example pk/sk for Permit (Backcountry registration permit #1 for orcs #9398 (Juan de Fuca)
```
pk: permit::9398
sk: backcountryRegistration::1
```
## Policies
Policies are rulesets that control how inventory is made available to users, how users can claim and exchange inventory, and how much users will pay for their inventory.

Certain policies are the same for many [**permits**](#permits), hence policies being their own entity, rather than baked into the properties of permits. 

All policies inherit the properties from [base data type](#base-data-properties).

### Booking Policies
Booking policies define how inventory is made available to users and how users are able to claim inventory. They involve details like how long in advance a user is able to book a certain date, how long they are allowed to claim the inventory for, and when the user is expected to use their inventory by.

|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|minStay|`Duration`|The minimum duration a user is permitted to book at once|Y|
|maxStay|`Duration`|The maximum duration a user is permitted to book at once|Y|
|resWindowType|`String` or `Enum`|The type of advanced booking window, 'rolling' or 'fixed'|Y|
|rollingWindowDuration|`Duration`|The duration of the rolling window|N|
|fixedWindowOpenDate|`DateTime`|The datetime after which a user is permitted to book|N|
|openBookingTime|`Time`|The time of day after which a user is permitted to book|Y|
|closeBookingTime|`Time`|The time of day after which a user is no longer permitted to book for that day|Y|
|checkInTime|`Time`|The time of day after which a user is permitted to check in to their inventory|Y|
|checkOutTime|`Time`|The time of day after which a user must have vacated/given up their inventory|Y|
|noShowTime|`Time`|The time of day after which a user is considered to have no-showed if they have not already checked in.
|allDatesBookedIntervals|[`Interval`]|Intervals of dates within which a user cannot book a portion of dates - that is, if any date of their booking coincides with a date in `allDatesBookedIntervals`, they must also book all of the other dates within the `Interval`. Common on holiday weekends.|N|

Example policy pk/sk (Booking policy #1)
```
pk: policy::booking
sk: 1
```

### Change Policies
Change policies define how users are able to change existing claims they may have on inventory. Cancellations fall within change policies as the user is still changing an existing claim they have by returning all their claimed inventory to the system. Fee + Change policies can likely be rolled into 1 policy type.
|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|areChangesAllowed|`Boolean`|Is the user permitted to change their inventory?|Y|
|changeWindowDuration|`Duration`|The duration prior to the first date of a booking where a user is penalized in addition to change fees for making changes to their inventory. Before this window, changes and cancellations receive a full refund less change fees|Y|
|changeRestrictedDuration|`Duration`|The duration after creating or changing a booking that a user is forbidden from making further changes (discourages speculative booking)|N|
|inWindowNightsForfeit|`Number`|The number of nights worth of fees forfeit in addition to cancellation fees if the user makes changes within the change window|Y|
|sameDayNightsForfeit|`Number`|The number of nights worth of fees forfeit in addition to cancellation fees if the user makes changes on the same day of their scheduled arrival|N|
|isFeeWaivedInWindow|`Boolean`|Is the change fee waived if the user makes a change within the change window (applicable to canoe circuits)|N|

### Fee Policies
Fee policies define how users are charged for their inventory, and if/how they are refunded in the event of a change or cancellation. Fee + Change policies can likely be rolled into 1 policy type.

|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|isAcceptingPayment|`Boolean`|Does BC Parks charge for this inventory?|Y|
|adultNightlyCampingFee|`Number`|Fee per adult per night, in dollars|N|
|childNightlyCampingFee|`Number`|Fee per child per night, in dollars|N|
|baseChangeFee|`Number`|The change fee per transaction, in dollars (for flat rates)|N|
|unitChangeFee|`Number`|The change fee per unit of inventory, in dollars (for rates dependent on inventory quantity)|N|
|baseReservationFee|`Number`|The base transaction fee, in dollars (for flat rates)|N|
|unitReservationFee|`Number`|Fee per unit of inventory in the transaction, in dollars (for rates dependent on inventory quantity)|N|

### Party Policies
Party policies dictate how user's camping parties are allowed to be composed. They limit the number of people in the party and how many people are allowed to be allotted per unit inventory.

|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|minOccupantAge|`Number`|The minimum age of the named occupant|N|
|minSize|`Number`|The minimum number of persons allowed in the party|Y|
|maxSize|`Number`|The maximum number of persons allowed in the party|Y|
|maxTentPadPeople|`Number`|The maximum number of persons allowed per tentpad|N|
|maxCanoePeople|`Number`|The maximum number of persons allowed per canoe|N|
|maxBunkPeople|`Number`|The maximum number of persons allowed per shelter bunk (1)|N|
|maxVehicles|`Number`|The maximum number of vehicles allowed|N|


## Operating Schedule*
\*Operating and reservable dates is currently being researched by OXD and has a September 2024 deadline. Operating schedule data modelling is pending the outcome of this research.

An operating schedule provides a daily breakdown of [**inventory**](#inventory) availability and governing policies. To be absolutely certain of which policies are applicable on which days, it is better to store this data explicitly rather than implicitly. This means that for every day of the year, for every piece of inventory, there should be granular policy and availability data, as opposed to having complicated rulesets that apply across many days and having the system infer the policy and availability data on the fly. 

Having ~365 operating schedule datapoints per inventory instance per year may seem counter-intuitive as it balloons database size, but high volume of data is not a problem for NoSQL databases like DynamoDB and replication of data is actually best-practice. 

## Places
Places are geospatial entities with a somewhat fixed, physical extension. They can be represented as a point (lat/long), a polyline, or a polygon (area). They are usually identified and specified by some given name. Some examples of places are:

-   parks/protected areas (polygon)
-   campgrounds (point)
-   wilderness camping regions (polygon)
-   trails (polyline)
-   timezones (polygon)

Each place must have a point representation if it is not already defined by a point. For polygons, this may be the centroid. For polylines, this may be a midpoint or a terminal point on the line (like a trailhead) that best represents the place. This point is used to determine several things, like the location where icons will be rendered for the place and which timezone the place belongs to.

At the point of writing, we only have authoritative information on protected areas as places, but a need for some intermediate place type has been identified (aka Cam zones).

The purpose of 'Cam zones' is twofold:
 - To identify groups of inventory that are relevant to one another, for example grouping all the tentpads in a single campground, especially if the protected area is listed to have multiple campgrounds within them.
 - To provide additional search references for end users when they are trying to identify what they do. For example: A user who wants to visit Sombrio Beach might search for 'Sombrio Beach', instead of 'Juan de Fuca'.

### Protected Area Properties
|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|pk|`String`|'protectedArea'|Y|
|sk|`String`|<orcs>|Y|
|orcs|`Number`|The orcs number of the parent park of the place|N|
|displayName|`String`|Display name synced from name data register|Y|
|legalName|`String`|Legal name synced from name data register|Y|
|location|`GeoJSON`|Protected area centroid, synced from CMS|N|
|boundary|`GeoJSON`|Valid geoJSON (geoPolygon) synced from Tantalis (only available in OpenSearch)|N|
|timezone|`String` or `Enum`|The IANA string timezone identifier of the place|Y|
|mapZoom|`Number`|Zoom level at which the item appears on a map|N|
|cwAssetId|`Number`|CityWide asset id, if applicable|N|

Example protected area pk/sk (Orcs 9398: Juan de Fuca)
```
pk: protectedArea
sk: 9398
```

### Place Data Properties
All places (Cam zones) inherit the properties from [base data type](#base-data-properties).
|**Property Name**|**Property Type**|**Definition**|**Mandatory?**|
|---|---|---|---|
|orcs|`Number`|The orcs number of the parent park of the place|N|
|address|`String`|Address of the place|N|
|location|`GeoJSON`|Valid geoJSON (geoPoint) describing the geospatial features of the place|N|
|boundary|`GeoJSON`|Valid geoJSON (geoPolygon) describing the geospatial features of the place|N|
|parentPlace|`Place`|The key of the immediate parent of the place|N|
|timezone|`String` or `Enum`|The IANA string timezone identifier of the place|Y|
|mapZoom|`Number`|Zoom level at which the item appears on a map|N|
|cwAssetId|`Number`|CityWide asset id, if applicable|N|
|featureGroup|`String`|A conventional way of grouping places - for example, all campgrounds on the Juan de Fuca Trail could be grouped by a featureGroup called 'Juan de Fuca Trail'|N|

Example place pk/sk (campground #5 (Little Kuitshe Creek Campground), in orcs #9398 (Juan de Fuca))
```
pk: place::9398
sk: campground::5
```
