# Data Model
Written: 2024-11-15 
Author: Team Osprey

This is the second pass of the data model now that we have had time to review the data we have.

### Goal
The goal of this document is to outline the datapoints that will most likely be necessary to move forward with PRDT reservation system as a whole.

## Data Types
The data model for PRDT contains the following data types, which will be explained thoroughly in the following sections:

 * Protected Areas
 * Subareas
 * Facilities
 * Activities
 * Products
 * Policies
 * Assets
 * Inventory
 * Permits

A visual representation of the data model can be found in this [**Mural**](https://app.mural.co/t/bcparks2575/m/dds5274/1731535677616/06b2ecf8407b6736c15629da1a05a057b5f49f86).

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
|`OSGeo`|OpenSearch-coded geospatial data. See https://opensearch.org/docs/latest/field-types/supported-field-types/geographic/
|`Primary Key`|DynamoDB primary key; either single key or combination partition and sort keys|
|`URL`|A `String` URL|

## Protected Areas
Also known as 'parks' these data types are the backbone of the data model and are uniquely defined by the ORCS of the park. The concept of a protected area is shared by several areas of BC Parks so this definition is analogous to those pre-understood concepts.

### Protected Area Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|'protectedArea'|'protectedArea'|
|sk|`String`|\<orcs>|'1'|
|orcs|`Number`|The ORCS number of the protected area|1|
|displayName|`String`|Display name synced from name data register|'Strathcona Provincial Park'|
|schema|`String` or `Enum`|The schema/data type (meta)|'protectedArea'|
|location|`OSGeo`|Protected area centroid, synced from CMS|`{type: "Point", coordinates: [lng, lat]}`|
|boundary|`OSGeo`|Protected area polygon or multipolygon boundary synced from Tantalis (only available in OpenSearch)|`{type: "Polygon", coordinates: [[[]]]}`|
|boundaryUrl|`String`|Url linking to an S3 storage bucket containing the geospatial information|''|
|timezone|`String` or `Enum`|The IANA string timezone identifier of the place|'America/Vancouver'|
|minMapZoom|`Number`|The smallest zoom level at which the object will appear|5|
|maxMapZoom|`Number`|The largest zoom level at which the object will appear|10|
|imageUrl|`String`|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

## Subareas
A subarea is a physical region within a park defined by a bounding box that groups [**facilities**](#facilities) and/or [**activities**](#activities) that are interrelated. [**Protected areas**](#protectedareas) can be large and have vast areas with no features of interest. Subareas break up parks into focus areas where users tend to visit. Subareas vary in size, but efforts are made to group interrelated features such that they can all be viewed on the same map while retaining enough detail to accurately convey relationships in distance, size, and proximity.

Subareas as defined by this project may share some similarities with other data concepts labelled 'subareas' from other data sources in BC Parks, but this subarea concept is not directly related to any preexisting data concept. Rather, there are too few descriptive names to go around to all the different data concepts that delineate their idiosyncrasies. 'Subarea' is the current term chosen to define this specific data concept and does not imply any relationship with preexisting notions of 'subareas'. The term may change if a better one is found.

### Subarea Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|subarea::\<orcs>|'subarea::7'|
|sk|`String`|\<subareaID>|'1'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the subarea|'Cheakamus Lake Area'|
|description|`String`|Description of the subarea|'Describes the Cheakamus Lake area'|
|schema|`String` or `Enum`|The schema/data type (meta)|'subarea'|
|location|`OSGeo`|Subarea centroid, synced from CMS|`{type: "Point", coordinates: [lng, lat]}`|
|boundary|`OSGeo`|Subarea polygon or multipolygon boundary (only available in OpenSearch)|`{type: "Polygon", coordinates: [[[]]]}`|
|timezone|`String` or `Enum`|The IANA string timezone identifier of the place|'America/Vancouver'|
|minMapZoom|`Number`|The smallest zoom level at which the object will appear|5|
|maxMapZoom|'Number'|The largest zoom level at which the object will appear|10|
|imageUrl|'String'|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

## Facilities
A facility is a specific physical location defined by a geographical latitude and longitude. This makes a facility similar in definition to a  [**subarea**](#subareas), but on a more granular scale. They typically refer to a man-made feature like a trail, parking-lot, campground, or viewpoint, but they may be used in the future to also refer to a natural feature like a lake or mountain. They generally support  [**activities**](#activities) that park users may be interested in and usually refer to the location where the user can enjoy such activities. One facility may support none-to-many activities. Users may need permission to visit, stay at, or otherwise use certain facilities. 

Similar to subareas, facilities may have some similarities to preexisting data concepts within BC Parks, but they are entirely their own concept within this data model.

### Facility Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|facility::\<orcs>|'facility::7'|
|sk|`String`|\<facilityType>::\<facilityId>|'parking::1'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the facility|'Cheakamus Lake Trailhead Parking Lot'|
|description|`String`|Description of the facility|'Describes the Cheakamus Lake Trailhead Parking Lot'|
|schema|`String` or `Enum`|The schema/data type (meta)|'facility'|
|facilityType|`String` or `Enum`|The facility type (meta)|'parking'|
|location|`OSGeo`|Facility centroid, synced from CMS|`{type: "Point", coordinates: [lng, lat]}`|
|address|`String`|Street address of the facility - used for map routing|'Cheakamus Lake Rd, Whistler, BC V0N 1B1'|
|identifier|`Number`|Also `facilityId`. Disambiguates the facility if there are many facilities of a certain type within a protected area|1|
|subarea|`String`| pk/sk of parent subarea separated by `#`|'subarea::7#1'|
|activities|`[String]`|List of `sk`s for activities that are associated with the facility. Note that activity `pk` should be able to be inferred from the orcs of the parent park|['dayuse::1', 'dayuse::2'] 
|timezone|`String` or `Enum`|The IANA string timezone identifier of the facility|'America/Vancouver'|
|minMapZoom|`Number`|The smallest zoom level at which the object will appear|5|
|maxMapZoom|'Number'|The largest zoom level at which the object will appear|10|
|showOnMap|`Boolean`|Whether or not to allow this facility to be rendered on a map|`true`|
|imageUrl|'String'|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|
|searchTerms|`String`|A list of terms that OpenSearch can index to guide users to the facility|'[Helm Creek, Singing Creek]'|

## Activities
An activity is a specific experience or offering provided by BC Parks at one or many facilities (physical locations). They are ultimately defined by the type of experience combined with the list of [**facilities**](#facilities) they are offered at. If more than 1 of the same type of experience is offered at the same list of facilities, the activities are disambiguated with an `identifier`, i.e. 1, 2, 3...

Types of activities include but are not limited to: camping (frontcountry/backcountry/group), cabin use (frontcountry/backcountry), day-use (parking, trail passes, picnic shelters), boat launching, and canoe circuits.

Activities are at roughly the same level of data hierarchy as facilities. The reason for this is to group together different search mechanisms that users may take to find what they are looking for. Within a user's destination of choice ([**subarea**](#subarea)), the user may choose where they want to visit (facility) or what they want to do (activity). In cases where a user knows where they want to visit, for example, 'I want to go to Allouette Lake South Beach', the Allouette Lake South Beach facility shows the user what activities they can do there (day use parking, boat launching). In cases where a user knows what they want to do, for example 'I want to go backcountry camping in Cape Scott Park', the Cape Scott Backcountry Camping activity shows the user where they can go backcountry camping within the park. 

Activities and facilities form many-to-many relationships, but every activity must belong to at least 1 facility. The system will drive users to activities, as they are the datatype that will drive the user to the next step, [**products**](#products).

### Activity Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|activity::\<orcs>|'activity::7'|
|sk|`String`|\<activityType>::\<activityId>|'dayuse::1'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the activity|'Cheakamus Lake Day Use'|
|description|`String`|Description of the facility|'Describes the Cheakamus Lake Day Use activity'|
|schema|`String` or `Enum`|The schema/data type (meta)|'activity'|
|activityType|`String` or `Enum`|The activity type (meta)|'dayuse'|
|subActivityType|`String` or `Enum`|The type of activity type (meta)|'parking'|
|identifier|`Number`|Also `activityId`. Disambiguates the activity if there are many activities of a certain type within a protected area|1|
|subarea|`String`| pk/sk of parent subarea separated by `#`|'subarea::7#1'|
|facilities|`[String]`|List of `sk`s for facilities that are associated with the actvitiy. Note that facility `pk` should be able to be inferred from the orcs of the parent park|['parking::1', 'parking::2'] 
|imageUrl|'String'|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|
|searchTerms|`String`|A list of terms that OpenSearch can index to guide users to the activity|'[Helm Creek, Singing Creek]'|

## Products
A product is an instance of an activity with of specific rules that govern that activity for a set period of time. Products control how [**inventory**](#inventory) is managed within the system. They are defined by their parent activity, the group of [**policies**](#policies) they abide by, and the span of time they are available for users. 

Each product has a set of base policies that control the booking/party/change/cancellation/fee rules for the product. 

Products are finer-grained offerings compared to activities. They adds definition to an activity to control how a user can experience/obtain the offering. For example, a 'Cheakamus Lake Day Use' activity implies that there are day-use offerings at Cheakamus Lake, but does not define when they are available, how many people can take advantage of the offering, what it costs, etc. The activity has two products, 'Cheakamus Lake Day Use: Morning Pass' and 'Cheakamus Lake Day Use: Afternoon Pass', each with specific opening and closing times, days of the week, capacity limits, and other rules that govern how users can have a 'Day Use' experience at 'Cheakamus Lake'. 

### Base Product Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|product::\<orcs>::\<activityType>::\<activityId>|'product::7::dayuse::1'|
|sk|`String`|\<productId>::properties |'1::properties'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the product|'Cheakamus Lake Day Use Pass (AM)'|
|description|`String`|Description of the product|'Morning parking pass for Cheakamus lake'|
|schema|`String` or `Enum`|The schema/data type (meta)|'product'|
|activity|`String`|Parent activity `sk`|'dayuse::1`|
|activityType|`String` or `Enum`|The activity type (meta)|'dayuse'|
|subActivityType|`String` or `Enum`|The type of activity type (meta)|'parking'|
|isPermitRequired|`Boolean`|Is a permit required to experience this product?|`true`|
|identifier|`Number`|Also `productId`. Disambiguates the product if there are many products within an activity|1|
|allocationType|`String` or `Enum`|Inventory allocation type (fixed or flex)|'flex'|
|baseCapacity|`Number`|Number of permits that can be issued for this product (if flex type)|49|
|isInventoryFinite|`Boolean`|Is the inventory controlled by the product part of an infinite pool?|`false`|
|isVisible|`Boolean`|Is this product currently surfaceable on the website?|`true`|
|status|`String` or `Enum`|Open/closed/other status of the product|'open'|
|bookingPolicy|`Number`|Booking policy `sk`|2|
|changePolicy|`Number`|Change policy `sk`|1|
|partyPolicy|`Number`|Booking policy `sk`|1|
|feePolicy|`Number`|Booking policy `sk`|1|
|imageUrl|'String'|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

### Specific Date Product Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|product::\<orcs>::\<activityType>::\<activityId>|'product::7::dayuse::1'|
|sk|`String`|\<productId>::\<shortDate>|'1::2024-12-02'|

## Policies
Policies are rulesets that control how inventory is made available to users, how users can claim and exchange inventory, and how much users will pay for their inventory.

Certain policies are the same for many [**products**](#products), hence policies being their own entity, rather than baked into the properties of products. 

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

## Inventory
Inventory refers to the most granular level of detail an offering from BC Parks can have, that is, it cannot be further divided to be offered to more than 1 user at a time. Inventory typically includes the specific offering (exactly what the user gets) and a specific time where the offering is valid (exactly when the user gets it). A basic example of inventory might be a single tentpad for a single night at a specific campground:
```
Tentpad #43 at Rathtrevor Beach campground on 2024-08-15
```
 If this tentpad is claimed by a user, then it cannot be claimed by another user on the same date. There may be another tentpad available on that date, or Tentpad #43 may be available on a different day, but both of those possibilities refer to different inventory. Once claimed by a single user, inventory is unavailable for others.

If the same user also claims Tentpad #43 at Rathtrevor for the following two nights (2024-08-16 and 2024-08-17), that user now has claimed 3 inventory items total, one for each night of their projected stay. 

Alternatively, if the same user instead claims Tentpad #44 and Tentpad #45 on the same night as Tentpad #43, that user still has claimed 3 inventory items total, though the inventory itself is different. 

When it comes to inventory allocation, and looking at inventory availability, there are two different types of inventory to consider: fixed and flex.

* **Fixed Inventory**  refers to inventory of specific assets that cannot be freely exchanged between users during a user's booking dates. The system must allocate the same specific asset to that user for the duration of that user's stay. Typically, fixed inventory refers to physical assets, like a campsite. If the user wants to camp for 3 nights, they don't want to switch campsites part way through their stay. Therefore, the system must ensure that the inventory that the user claims for their stay all refers to the same campsite asset. The campground may have availability on all 3 nights, but not have a single asset available for every night in question.
* **Flex Inventory** refers to inventory of non-specific assets or assets that can be freely exchanged between users during a user's booking dates. The system can be asset-agnostic when allocating inventory or checking availability on any given day. Flex inventory is typically conceptual inventory that exists only as needed. One example of flex inventory is the day-use capacity for a trail. The maximum capacity of the trail can be easily adjusted on different dates to suit park operator needs. Users can claim inventory (capacity units on any given day) until the trail capacity limit is reached. If a user wants to visit the trail 3 days in a row, the system only needs to ensure there is capacity available on each day, not whether the user has the same inventory for all 3 days.  Another counterintuitive example of flex inventory is backcountry reservations. Backcountry reservations 'guarantee' the user a tentpad at their destination, but they do not assign the user a specific asset, ie specific tentpad. Like the day-use example, backcountry reservation offerings have a daily capacity limit equal to the number of tentpads the offering includes. If a user wants to make a backcountry reservation for 3 consecutive days, the system does not have to ensure they are assigned the same tentpad for the duration of the user's visit. So long as there is availability on all of the days in their visit, the user can show up on their arrival date, pick any unoccupied tentpad, and they will not have to move for the duration of their stay.

## Assets
Assets are the non-temporal part of inventory. They can be something physical, like a tentpad (but not on any specific date) or conceptual, like trail capacity (again, not on any specific date).

## Permits
A permit is a document that captures inventory and assigns it to a specific user. It can be thought of a receipt or other proof of purchase that grants a user permission to use a specific asset on a specific date. It also doubles as an administrative record of which inventory items were claimed on which dates and by whom. 

**Asset** -> available on a specific date -> **Inventory** -> claimed by a specific user -> **Permit**

## Booking
A booking is a group of permits held by the same user for the same asset/inventory that span either a single date or many continous dates.

Examples:
* Tentpad #43 at Rathtrevor Beach campground from 2024-08-15 to 2024-08-17 (3 nights, 3 inventory/permits, 1 fixed asset)
* One day-use pass for Joffre Lakes on 2024-07-22 (1 day, 1 inventory/permit, 1 flex asset)
* One tentpad at Wedgemount Lake campground (backcountry reservation) from 2024-08-15 to 2024-08-17 (3 nights, 3 inventory/permits, 1 flex asset)
