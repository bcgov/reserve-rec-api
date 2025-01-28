# Data Model
Written: 2024-11-15 
Updated: 2025-01-16
Author: Team Osprey

**Note** this data model is a work-in-progress  and is subject to change at any time.

### Goal
The goal of this document is to outline the datapoints that will most likely be necessary to move forward with PRDT reservation system as a whole.

## Property Types
Below is a table of the data types used in the MVD to enforce uniform data representation across all datapoints. 

|**Property Type**|**Description**|
|---|---|
|`String`|Primitive type|
|`Number`|Primitive type|
|`Boolean`|Primitive Type|
|`DateTime`*|Full ISO timestamp, eg: `2025-01-01T00:00:00.0000Z`|
|`Date`*|Calendar date presented as an object, eg: `{year: 2024, month: 7, day: 18}`|
|`ISODate`*|Calendar date presented as `YYYY-MM-DD`|
|`Time`*|Time of day in 24h time, presented as an object, eg: `{hour: 12, minute: 30, second: 0}`|
|`Duration`*|A non-specific, continuous span of time, presented as an object, eg: `{days: 14}`|
|`Interval`*|A specific, continuous span of time with a start and end bound by `DateTimes`|
|[`propertyType`]|An array of `propertyType`|
|`Enum`|[Enumerator](#enums) - Special type that denotes a single value in a group of predefined/unchanging values|
|`GeoJSON`|[Valid geoJSON](https://geojson.org/). |
|`OSGeo`|[OpenSearch-coded](https://opensearch.org/docs/latest/field-types/supported-field-types/geographic/) geospatial data.
|`Primary Key`|DynamoDB primary key; either single key or combination partition and sort keys|
|`URL`|A `String` URL|

* Review [luxon](https://moment.github.io/luxon/api-docs/index.html#duration) documentation regarding time-related property types.

## DynamoDB Partitioning
DynamoDB will serve as the primary database framework for most authoritative data in the project. The data model for this project uses a compound `pk`/`sk` primary key structure in DynamoDB. To maintain consistency and readability in the database, the `pk`/`sk` naming for data items should endeavour to follow this convention:
#### Partition Key (pk)
Should start with the name of the datatype schema, and be followed by a collection identifier. Properties should be connected by a double colon `::`. See [schemas](#schemas) for more information.
```
<schema>::<collectionId>
```
```json
// Simple pk example: Protected Area:
// schema: 'protectedArea'
// collection identifier: not necessary as protected areas are a reasonably small dataset
"pk": "protectedArea"
```
```json
// Standard pk example: Facility:
// schema: 'facility'
// collection identifier: the ORCS of the parent protected area that contains the facility
"pk": "facility::7"
```
```json
// Complex pk example: Product:
// schema: 'product'
// collection identifier: the ORCS of the parent protected area that contains the facility where the product is offered, the type of activity the product pertains to, and the identifier of the activity
"pk": "product::7::dayuse::1"
```
#### Sort Key (sk)
Should uniquely identify the data item within the partition as concisely as possible while utilizing data properties that may assist in search filtering. 
* If the number of items within a partition can grow indefinitely, an `identifier` should be used. An `identifier` will logically increment every time a new item is added to the partition. 
* If the number of items within a partition is finite (such as items correlating to dates), then the `sk` should be comprised of data properties that are inherently unique to that item.

In some cases a combination of the above two methods may be necessary.

```json
// Simple sk example: Protected Area:
// Unique identification method: ORCS - all protected areas have unique ORCS.
"pk": "protectedArea"
"sk": "7"
```
```json
// Scalable sk with identifier example: Facility:
// Unique identification method: Type of facility ('parking') and identifier (1 - the first parking
// lot in ORCS 7)
"pk": "facility::7"
"sk": "parking::1"
```
```json
// Finite sk example: Product Schedule:
// Unique identification method: Product identifier and the specific date of interest
// Information on ORCS 7 dayuse activity 1 product 1 specifically on 2025-01-15 
"pk": "product::7::dayuse::1"
"sk": "1::2025-01-15"
```

## OpenSearch Partitioning
OpenSearch will serve as a supplementary data tool alongside DynamoDB that will facilitate more complicated search patterns than can be supported by DynamoDB. In particular, OpenSearch excels at unstructured text and geospatial searches in large data pools. In cases where users will be 'browsing' or otherwise searching for non-specific items, OpenSearch will be used first to parse the database efficiently. Narrower searches will default to DynamoDB.

Since DynamoDB is the authoritative source of truth for data in the project, OpenSearch indexes will be populated by DynamoStreams that replicate any change made in DynamoDB to the appropriate OpenSearch index.

* In the case of some geospatial data, the related geojson is too large to fit within the DynamoDB item size limits. In this case, AWS S3 will be used to store the source of truth, and will be linked to the DynamoDB item, possibly by an S3 URL. The geospatial data in S3 will also be replicated into OpenSearch.

OpenSearch uses single `id`s to uniquely identify items in an index. The naming convention for `id` should be a combination of the `pk`/`sk` from the parent item in DynamoDB, separated by `#`.

```json
// Example: Facility
"id": "facility::7#parking::1"
```

# Schemas

The data model for PRDT contains the following data types, which will be explained thoroughly in the following sections:

 * Protected Areas
 * Geozones
 * Facilities
 * Activities
 * Products
 * Policies
 * Assets
 * Inventory
 * Permits

A visual representation of the data model can be found in this [**Mural**](https://app.mural.co/t/bcparks2575/m/dds5274/1731535677616/06b2ecf8407b6736c15629da1a05a057b5f49f86).

## Protected Areas
Also known as 'parks' these data types are the backbone of the data model and are uniquely defined by the ORCS of the park. The concept of a protected area is shared by several areas of BC Parks so this definition is analogous to those pre-understood concepts.

### Protected Area Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|'protectedArea'|'protectedArea'|
|sk|`String`|\<orcs>|'1'|
|orcs|`Number`|The ORCS number of the protected area|1|
|displayName|`String`|Display name synced from name data register|'Strathcona Provincial Park'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'protectedArea'|
|location|`OSGeo`|Protected area centroid, synced from CMS|`{type: "Point", coordinates: [lng, lat]}`|
|boundary|`OSGeo`|Protected area polygon or multipolygon boundary synced from Tantalis (only available in OpenSearch)|`{type: "Polygon", coordinates: [[[]]]}`|
|boundaryUrl|`String`|Url linking to an S3 storage bucket containing the geospatial information|''|
|timezone|[`Enum`](#timezone-enums)|The IANA string timezone identifier of the place|'America/Vancouver'|
|minMapZoom|`Number`|The smallest zoom level at which the object will appear|5|
|maxMapZoom|`Number`|The largest zoom level at which the object will appear|10|
|imageUrl|`String`|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

## Geozones
A geozone is a physical region within a park defined by a bounding box that groups [**facilities**](#facilities) and/or [**activities**](#activities) (and other future geolocated data concepts) that are interrelated. [**Protected areas**](#protectedareas) can be large and have vast areas with no features of interest. Geozones are spatial regions of the province that focus on areas of interest. They can be used for a variety of functions: for the public, geozones can group together facilities and activities that are all related to a common experience, like all the trails and campgrounds within Strathcona Park that relate to the Bedwell and Cream lakes experience. For administrative users, geozones can group together features that are all managed by the same bundle. Geozones vary in size, but efforts are made to group interrelated features such that they can all be viewed on the same map while retaining enough detail to accurately convey relationships in distance, size, and proximity. They can be used to create powerful and highly customized data searching and collecting experiences.

Geozones as defined by this project may share some similarities with other data concepts labelled 'subareas' from other data sources in BC Parks, but this geozone concept is not directly related to any preexisting data concept. 

#### Geozone Collections
Since geozones can be user-defined, there exists a need to differentiate groups of geozones from one another based on their intended audience. A particular group of geozones may be used by BC Parks to drive public searches to certain experiences that are made up of groups of features. Using the previous example of Bedwell Lakes, a geozone that encapsulates all the trails, parking lots, campgrounds and other data items that define the 'Bedwell Lakes' experience can be used as a landing zone for public users who start their query with 'bedwell'. Similar geozones can be used to drive users to the other 'experiences' offered at Strathcona, or even at other protected areas entirely. 

In the example above, the collection of all geozones across all protected areas that may contain reservable features for BC Parks would have its own collection, which could be further differentiated by incorporating the `orcs` of the parent protected area.

Geozones are partitioned based on their geozone collection to maintain higher cardinality in DynamoDB. The `pk` structure of a BC Parks geozone collection may look something like:

```
pk: geozone::bcparks::7
```
Querying for the above will cheaply return all geozones relating to `orcs=7` (Garibaldi Park), allowing front ends to create home pages for protected areas that easily route into areas of the protected area that users actually care about. 

A user with an account may want to define custom geozones for geospatial areas that are interesting only to them. DynamoDB can partition these geozones into their own geozone collections that may look something like:
```
pk: geozone::user::<userId>
```
High cardinality enables DynamoDB to decouple the size of the database from its ability to quickly and efficiently return queries. In other words, it improves scalability. 

### Geozone Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|geozone::\<gzCollectionId>|'subarea::bcparks::7'|
|sk|`String`|\<subareaId>|'1'|
|gzCollectionId|`String`|See [geozone collections](#geozone-collections)|'bcparks::7`
|orcs|`Number`|The ORCS number of the parent protected area, if applicable|7|
|displayName|`String`|Display name for the geozone|'Cheakamus Lake Area'|
|description|`String`|Description of the geozone|'Describes the Cheakamus Lake area'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'geozone'|
|identifier|`Number`|Also `geozoneId`. Disambiguates the geozone if there are many geozones within a single geozone collection.|1|
|geozoneId|`Number`|See `identifier`|1|
|location|`OSGeo`|Geozone centroid, synced from CMS|`{type: "Point", coordinates: [lng, lat]}`|
|envelope|`OSGeo`|Geozone bounding box (only available in OpenSearch)|`{type: "Envelope", coordinates: [[[]]]}`|
|timezone|[`Enum`](#timezone-enums)|The IANA string timezone identifier of the geozone. A single timezone must be picked if the geozone crosses timezone boundaries.|'America/Vancouver'|
|isVisible|`Boolean`|Is the geozone visible to the public?|`true`|
|minMapZoom|`Number`|The smallest zoom level at which the object will appear|5|
|maxMapZoom|`Number`|The largest zoom level at which the object will appear|10|
|facilities|`[String]`|A list of `sk`s of facilities belonging to the subarea (facility `pk` can be inferred)|[parking::1, parking::2, trail::1]|
|activities|`[String]`|A list of `sk`s of activities belonging to the subarea (activity`pk` can be inferred)|[dayuse::1, dayuse::2]|
|imageUrl|`String`|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

## Facilities
A facility is a specific physical location defined by a geographical latitude and longitude. This makes a facility similar in definition to a  [**geozone**](#geozone), but on a more granular scale. They typically refer to a man-made feature like a trail, parking-lot, campground, or viewpoint, but they may be used in the future to also refer to a natural feature like a lake or mountain. They generally support  [**activities**](#activities) that park users may be interested in and usually refer to the location where the user can enjoy such activities. One facility may support none-to-many activities. Users may need permission to visit, stay at, or otherwise use certain facilities. 

Similar to geozones, facilities may have some similarities to preexisting data concepts within BC Parks, but they are entirely their own concept within this data model.

### Facility Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|facility::\<orcs>|'facility::7'|
|sk|`String`|\<facilityType>::\<facilityId>|'parking::1'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the facility|'Cheakamus Lake Trailhead Parking Lot'|
|description|`String`|Description of the facility|'Describes the Cheakamus Lake Trailhead Parking Lot'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'facility'|
|facilityType|[`Enum`](#facilitytype-enums)|The facility type (meta)|'parking'|
|location|`OSGeo`|Facility centroid, synced from CMS|`{type: "Point", coordinates: [lng, lat]}`|
|address|`String`|Street address of the facility - used for map routing|'Cheakamus Lake Rd, Whistler, BC V0N 1B1'|
|identifier|`Number`|Also `facilityId`. Disambiguates the facility if there are many facilities of a certain type within a protected area|1|
|facilityId|`Number`|See `identifier`|1|
|geozone|`String`| pk/sk of parent geozone separated by `#`|'subarea::7#1'|
|activities|`[String]`|List of `sk`s for activities that are associated with the facility. Note that activity `pk` should be able to be inferred from the orcs of the parent park|['dayuse::1', 'dayuse::2'] 
|isVisible|`Boolean`|Is the facility visible to the public?|`true`|
|timezone|[`Enum`](#timezone-enums)|The IANA string timezone identifier of the facility|'America/Vancouver'|
|location|`OSGeo`|Facility geospatial centroid.|`{type: "Point", coordinates: [lng, lat]}`|
|minMapZoom|`Number`|The smallest zoom level at which the object will appear|5|
|maxMapZoom|`Number`|The largest zoom level at which the object will appear|10|
|showOnMap|`Boolean`|Whether or not to allow this facility to be rendered on a map|`true`|
|imageUrl|`String`|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|
|searchTerms|`String`|A list of terms that OpenSearch can index to guide users to the facility|'[Helm Creek, Singing Creek]'|

## Activities
An activity is a specific experience or offering provided by BC Parks at one or many facilities (physical locations). They are ultimately defined by the type of experience combined with the list of [**facilities**](#facilities) they are offered at. If more than 1 of the same type of experience is offered at the same list of facilities, the activities are disambiguated with an `identifier`, i.e. 1, 2, 3...

Types of activities include but are not limited to: camping (frontcountry/backcountry/group), cabin use (frontcountry/backcountry), day-use (parking, trail passes, picnic shelters), boat launching, and canoe circuits.

Activities are at roughly the same level of data hierarchy as facilities. The reason for this is to group together different search mechanisms that users may take to find what they are looking for. Within a user's destination of choice ([**geozone**](#geozone)), the user may choose where they want to visit (facility) or what they want to do (activity). In cases where a user knows where they want to visit, for example, 'I want to go to Alouette Lake South Beach', the Alouette Lake South Beach facility shows the user what activities they can do there (day use parking, boat launching). In cases where a user knows what they want to do, for example 'I want to go backcountry camping in Cape Scott Park', the Cape Scott Backcountry Camping activity shows the user where they can go backcountry camping within the park. 

Activities and facilities form many-to-many relationships, but every activity must belong to at least 1 facility. The searching mechanism of the system as a whole will funnel users to activities, as they are the datatype that will drive the user to the level of data hierarchy where they are able to book specific experiences -, [**products**](#products).

### Activity Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|activity::\<orcs>|'activity::7'|
|sk|`String`|\<activityType>::\<activityId>|'dayuse::1'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the activity|'Cheakamus Lake Day Use'|
|description|`String`|Description of the facility|'Describes the Cheakamus Lake Day Use activity'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'activity'|
|activityType|[`Enum`](#activitytype-enums)|The activity type (meta)|'dayuse'|
|subActivityType|[`Enum`](#subactivitytype-enums)|The type of activity type (meta)|'vehicleParking'|
|identifier|`Number`|Also `activityId`. Disambiguates the activity if there are many activities of a certain type within a protected area|1|
|activityId|`Number`|See `identifier`.|1|
|geozone|`String`| pk/sk of parent geozone separated by `#`|'subarea::7#1'|
|facilities|`[String]`|List of `sk`s for facilities that are associated with the activity. Note that facility `pk` should be able to be inferred from the orcs of the parent park|['parking::1', 'parking::2'] 
|isVisible|`Boolean`|Is the activity visible to the public?|`true`|
|imageUrl|String|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|
|searchTerms|`String`|A list of terms that OpenSearch can index to guide users to the activity|'[Helm Creek, Singing Creek]'|

## Products
A product is an instance of an activity with of specific rules that govern that activity for a set period of time. Products control how [**inventory**](#inventory) is managed within the system. They are defined by their parent activity, the group of [**policies**](#policies) they abide by, and the span of time they are available for users. 

Each product has a set of base policies that control the booking/party/change/cancellation/fee rules for the product. 

Products are finer-grained offerings compared to activities. They adds definition to an activity to control how a user can experience/obtain the offering. For example, a 'Cheakamus Lake Day Use' activity implies that there are day-use offerings at Cheakamus Lake, but does not define when they are available, how many people can take advantage of the offering, what it costs, etc. The activity has two products, 'Cheakamus Lake Day Use: Morning Pass' and 'Cheakamus Lake Day Use: Afternoon Pass', each with specific opening and closing times, days of the week, capacity limits, and other specific rules that govern how users can have a 'Day Use' experience at 'Cheakamus Lake'. 

### Base Product Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|product::\<orcs>::\<activityType>::\<activityId>|'product::7::dayuse::1'|
|sk|`String`|\<productId>::properties |'1::properties'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|displayName|`String`|Display name for the product|'Cheakamus Lake Day Use Pass (AM)'|
|description|`String`|Description of the product|'Morning parking pass for Cheakamus lake'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'product'|
|activity|`String`|Parent activity `sk`|'dayuse::1`|
|activityType|[`Enum`](#activitytype-enums)|The activity type (meta)|'dayuse'|
|subActivityType|[`Enum`](#subactivitytype-enums)|The type of activity type (meta)|'vehicleParking'|
|isPermitRequired|`Boolean`|Is a permit required to experience this product?|`true`|
|identifier|`Number`|Also `productId`. Disambiguates the product if there are many products within an activity|1|
|productId|`Number`|See `identifier`.|1|
|season|[`Enum`](#season-enums)|To be used to differentiate products that vastly change between seasons|`winter`|
|allocationType|[`Enum`](#inventory-allocationtype-enums)|Inventory allocation type (fixed or flex)|'flex'|
|baseCapacity|`Number`|Number of permits that can be issued for this product (if flex type)|49|
|isInventoryFinite|`Boolean`|Is the inventory controlled by the product part of an infinite pool?|`false`|
|isVisible|`Boolean`|Is this product currently surfaceable on the website?|`true`|
|status|[`Enum`](#facility-status-enums)|Open/closed/other status of the facility (or other destination where the product is offered). Differs from whether or not the product is currently requiring permits. |'open'|
|bookingPolicy|`Number`|Booking policy `sk`|2|
|changePolicy|`Number`|Change policy `sk`|1|
|partyPolicy|`Number`|Booking policy `sk`|1|
|feePolicy|`Number`|Booking policy `sk`|1|
|imageUrl|'String'|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

Sometimes product properties change with time, which is handled by [calendars](#calendars) and schedule building. Building a schedule results in date-specific products. See [scheduling](#scheduling) for more details.

### Specific Date Product Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|product::\<orcs>::\<activityType>::\<activityId>|'product::7::dayuse::1'|
|sk|`String`|\<productId>::\<shortDate>|'1::2024-12-02'|

## Inventory
Inventory refers to the most granular level of detail an offering from BC Parks can have, that is, it cannot be further divided to be offered to more than 1 user at a time. Inventory typically includes the specific offering (exactly what the user gets) and a specific time where the offering is valid (exactly when the user gets it). A basic example of inventory might be a single tentpad for a single night at a specific campground:
```
Tentpad #43 at Rathtrevor Beach campground on 2024-08-15
```
 If this tentpad is claimed by a user, then it cannot be claimed by another user on the same date. There may be another tentpad available on that date, or Tentpad #43 may be available on a different day, but both of those possibilities refer to different inventory. Once claimed by a single user, inventory is unavailable for others.

If the same user also claims Tentpad #43 at Rathtrevor for the following two nights (2024-08-16 and 2024-08-17), that user now has claimed 3 inventory items total, one for each night of their projected stay (1 [Booking](#bookings): 1 [asset](#assets) for 3 nights).

Alternatively, if the same user instead claims Tentpad #44 and Tentpad #45 on the same night as Tentpad #43, that user still has claimed 3 inventory items total, though the inventory itself is different (3 [Bookings](#bookings): 3 [assets](#assets) for 1 night each). 

When it comes to inventory allocation, and looking at inventory availability, there are two different types of inventory to consider: fixed and flex.

* **Fixed Inventory**  refers to inventory of specific [assets](#assets) that cannot be freely exchanged between users during a user's [booking](#booking) dates. The system must allocate the same specific asset to that user for the duration of that user's stay. Typically, fixed inventory refers to physical assets, like a campsite. If the user wants to camp for 3 nights, they don't want to switch campsites part way through their stay. Therefore, the system must ensure that the inventory that the user claims for their stay all refers to the same campsite asset. The campground may have availability on all 3 nights, but not have the same single asset available for every night in question.
* **Flex Inventory** refers to inventory of non-specific assets or assets that can be freely exchanged between users during a user's booking dates. The system can be asset-agnostic when allocating inventory or checking availability on any given day. Flex inventory is typically conceptual inventory that exists only as needed. One example of flex inventory is the day-use capacity for a trail. The maximum capacity of the trail can be easily adjusted on different dates to suit park operator needs. Users can claim inventory (capacity units on any given day) until the trail capacity limit is reached. If a user wants to visit the trail 3 days in a row, the system only needs to ensure there is capacity available on each day, not whether the user has the same inventory for all 3 days.  Another counterintuitive example of flex inventory is backcountry reservations. Backcountry reservations 'guarantee' the user a tentpad at their destination, but they do not assign the user a specific asset, ie specific tentpad. Like the day-use example, backcountry reservation offerings have a daily capacity limit equal to the number of tentpads the offering includes. If a user wants to make a backcountry reservation for 3 consecutive days, the system does not have to ensure they are assigned the same tentpad for the duration of the user's visit. So long as there is availability on all of the days in their visit, the user can show up on their arrival date, pick any unoccupied tentpad, and they will not have to move for the duration of their stay.

## Assets
Assets are the non-temporal part of inventory. They can be something physical, like a tentpad (but not on any specific date) or conceptual, like trail capacity (again, not on any specific date). An asset persists year-round, meaning it isn't created or destroyed based on what time of year it is. An asset can be made available to users through a product, which makes an asset availability time-dependent (basically turning it into inventory). 

For example, a tentpad in a campground is physically persistent year-round, but the campground might only be open from May to September. A product makes the tentpad (asset) available between May and September (inventory), so a user can access the tentpad only when the campground is open, despite the asset always existing.

Physically permanent assets should be accompanied by a latitude and longitude. Other properties may be important depending on the type of asset in question: for example, it might be important to show a picture of a campsite.

In the future, assets may also be used to track resources that have less importance to reservations, like outhouses, fire rings, etc. 

|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|asset::\<assetCollectionId>|asset::bcparks::7::vehicleParking::1|
|sk|`String`|\<assetType>::\<assetId>|parkingStall::1|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'asset'|
|assetCollectionId|`String`|Similar to [`gzCollectionId`](#geozone-collections)|'bcparks::7::vehicleParking::1'|
|displayName|`String`|Human readable name for the asset|'Parking Stall 1'|
|description|`String`|Human readable description of the asset|'It's the first parking stall'|
|assetType|[`Enum`](#assettype-enums)|The asset type (meta)|`parkingStall|
|identifier|`Number`|Also `assetId`. Disambiguates the asset if there are many assets of the same type within an assetCollection. |1|
|assetId|`Number`|See `identifier`|`|
|location|`OSGeo`|Asset geospatial centroid.|`{type: "Point", coordinates: [lng, lat]}`|
|minMapZoom|`Number`|The smallest zoom level at which the asset will appear|5|
|maxMapZoom|`Number`|The largest zoom level at which the asset will appear|10|
|showOnMap|`Boolean`|Whether or not to allow this asset to be rendered on a map|`true`|
|imageUrl|`String`|Url to an image representing the object|'https://picsum.photos/500'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|
|searchTerms|`String`|A list of terms that OpenSearch can index to guide users to the asset|'[Helm Creek, Singing Creek]'|

### Additional Asset Properties
In the case where an asset is a campsite (likely a common use for an asset), additional properties may be of interest to include. Some examples follow:
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|campsiteNumber|`Number`|The number of the campsite in the campground|1|
|campsiteLoopNumber|`Number`|The number of the campsite loop the campsite is a part of|1|
|campsiteType|`Enum`|List of campsite types|'regular'|
|hasPicnicTable|`Boolean`|Whether or not there is a picnic table with the campsite |`true`|
|hasFireRing|`Boolean`|Whether or not there is a fire ring with the campsite |`true`|
|hasSani|`Boolean`|Whether or not the campsite has a sanitation hookup|`false`|
|hasElec|`Boolean`|Whether or not the campsite has an electrical hookup|`false`|
|isWalkIn|`Boolean`|Whether or not the campsite is walk-in only|`false`|
|onCampgroundPerimeter|`Boolean`|Whether or not the campsite is on the edge of the campground (typically more popular)|`false`|
|onShoreline|`Boolean`|Whether or not the campsite is on the edge of a lake, the ocean, etc.|`false`|
|metersToPotWater|`Number`|Distance in meters to nearest potable water|16|
|metersToToilet|`Number`|Distance in meters to nearest toilet|34|
|metersToShower|`Number`|Distance in meters to nearest shower|34|
|rating|`Number`|Crowdsourced rating of the site|4.5|
|doubleSiteAssetKey|`PrimaryKey`|If the site is part of a double site, the pk/sk of the other site is listed here.|`{pk: asset::bcparks::193::loop1, sk: campsite::45 }`|

Naturally there is opportunity to make any number of custom properties with campsites or any other asset type to suit the needs of the system.

## Policies
Policies are rulesets that control how inventory is made available to users, how users can claim and exchange inventory, and how much users will pay for their inventory.

Certain policies are the same for many [**products**](#products), hence policies being their own entity, rather than baked into the properties of products.

### Root Policy Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|policy::\<policyType>|'policy::booking'|
|sk|`String`|\<policyId>|'1'|
|schema|[`Enum`](#schema-enums)|The schema/datatype (meta)|'policy'|
|identifier|`Number`|Also `policyId`. Disambiguates the policy if there are many policies of the same `policyType`.|1|
|policyId|`Number`|See `identifier`|1|
|displayName|`String`|Display name for the policy|'Standard Day Use Parking and Trail (ALL DAY) Booking Policy'|
|description|`String`|Description of the policy|'This booking policy is for Day Use - ALL DAY parking and trail passes.'|

### Booking Policies
Booking policies define how inventory is made available to users and how users are able to claim inventory. They involve details like how long in advance a user is able to book a certain date, how long they are allowed to claim the inventory for, and when the user is expected to use their inventory by.

|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|policyType|[`Enum`](#policyType-enums)|Policy type.|'booking'|
|minStay|`Duration`|The minimum duration a user is permitted to book at once|`{days: 1}`|
|maxStay|`Duration`|The maximum duration a user is permitted to book at once|`{days: 14}`|
|resWindowType|[`Enum`](#reservation-window-type-enums)|The type of advanced booking window, 'rolling' or 'fixed'|'rolling'|
|rollingWindowDuration|`Duration`|If rolling reservation window type, the duration of the rolling window|`{months: 4}`|
|fixedWindowOpenDate|`DateTime`|If fixed reservation window type, the datetime after which a user is permitted to book|`2025-01-17T08:00:00.000-8:00`|
|openBookingTime|`Time`|The time of day after which a user is permitted to book|`{hour: 7}`|
|closeBookingTime|`Time`|The time of day after which a user is no longer permitted to book for that day|`{hour: 18}`|
|checkInTime|`Time`|The time of day after which a user is permitted to check in to their inventory|`{hour: 14, minute: 30}`|
|checkOutTime|`Time`|The time of day after which a user must have vacated/given up their inventory|`{hour: 11}`|
|noShowTime|`Time`|The time of day after which a user is considered to have no-showed if they have not already checked in.|`{hour: 13}`|
|allDatesBookedIntervals|[`Interval`]|Intervals of dates within which a user cannot book a portion of dates - that is, if any date of their booking coincides with a date in `allDatesBookedIntervals`, they must also book all of the other dates within the `Interval`. Common on holiday weekends.|`[2025-06-28,2025-06-29, 2025-06-30, 2025-07-01]`|

### Change Policies
Change policies define how users are able to change existing claims they may have on inventory. Cancellations fall within change policies as the user is still changing an existing claim they have by returning all their claimed inventory to the system. Fee + Change policies can likely be rolled into 1 policy type.

|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|policyType|[`Enum`](#policyType-enums)|Policy type.|'change'|
|areChangesAllowed|`Boolean`|Is the user permitted to change their inventory?|`true`|
|changeWindowDuration|`Duration`|The duration prior to the first date of a booking where a user is penalized in addition to change fees for making changes to their inventory. Before this window, changes and cancellations receive a full refund less change fees|`{weeks: 2}`|
|changeRestrictedDuration|`Duration`|The duration after creating or changing a booking that a user is forbidden from making further changes (discourages speculative booking)|`{weeks: 1}`|
|inWindowNightsForfeit|`Number`|The number of nights worth of fees forfeit in addition to cancellation fees if the user makes changes within the change window|1|
|sameDayNightsForfeit|`Number`|The number of nights worth of fees forfeit in addition to cancellation fees if the user makes changes on the same day of their scheduled arrival|2|
|isFeeWaivedInWindow|`Boolean`|Is the change fee waived if the user makes a change within the change window (applicable to canoe circuits)|`false`|

### Fee Policies
Fee policies define how users are charged for their inventory, and if/how they are refunded in the event of a change or cancellation. Fee + Change policies can likely be rolled into 1 policy type.

|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|policyType|[`Enum`](#policyType-enums)|Policy type.|'fee'|
|isAcceptingPayment|`Boolean`|Does BC Parks charge for this inventory?|`true`|
|adultNightlyCampingFee|`Number`|Fee per adult per night, in dollars|10|
|childNightlyCampingFee|`Number`|Fee per child per night, in dollars|5|
|baseChangeFee|`Number`|The change fee per transaction, in dollars (for flat rates)|6|
|unitChangeFee|`Number`|The change fee per unit of inventory, in dollars (for rates dependent on inventory quantity)|6|
|baseReservationFee|`Number`|The base transaction fee, in dollars (for flat rates)|6|
|unitReservationFee|`Number`|Fee per unit of inventory in the transaction, in dollars (for rates dependent on inventory quantity)|6|

### Party Policies
Party policies dictate how user's camping parties are allowed to be composed. They limit the number of people in the party and how many people are allowed to be allotted per unit inventory.

|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|policyType|[`Enum`](#policyType-enums)|Policy type.|'party'|
|minOccupantAge|`Number`|The minimum age of the named occupant|16|
|minSize|`Number`|The minimum number of persons allowed in the party|1|
|maxSize|`Number`|The maximum number of persons allowed in the party|4|
|maxTentPadPeople|`Number`|The maximum number of persons allowed per tentpad|3|
|maxCanoePeople|`Number`|The maximum number of persons allowed per canoe|2|
|maxBunkPeople|`Number`|The maximum number of persons allowed per shelter bunk (1)|1|
|maxVehicles|`Number`|The maximum number of vehicles allowed|1|

## Permits
A permit is a document that captures inventory and assigns it to a specific user. It can be thought of a receipt or other proof of purchase that grants a user permission to use a specific asset on a specific date. It also doubles as an administrative record of which inventory items were claimed on which dates and by whom. 

**Asset** -> available on a specific date -> **Inventory** -> claimed by a specific user -> **Permit**

## Booking
A booking is a group of permits held by the same user for the same asset/inventory that span either a single date or many continuous dates.

Examples:
* Tentpad #43 at Rathtrevor Beach campground from 2024-08-15 to 2024-08-17 (3 nights, 3 inventory/permits, 1 fixed asset)
* One day-use pass for Joffre Lakes on 2024-07-22 (1 day, 1 inventory/permit, 1 flex asset)
* One tentpad at Wedgemount Lake campground (backcountry reservation) from 2024-08-15 to 2024-08-17 (3 nights, 3 inventory/permits, 1 flex asset)

# Scheduling
All of the previous datatypes primarily handle cases where data is static - that is, it does not change with time. In reality in a reservation system, properties like availability, cost, capacity, and others are in constant fluctuation. The reservation needs a way to keep track of these temporal properties and their relationships to static properties and datatypes.

As defined by [inventory](#inventory), it is predicted that the shortest interval that temporal properties can change between is **1 day**. Therefore, this implies that the properties of a single asset/product cannot have more than 1 value for any given day, and our scheduling system must deal in **days**.

Note: an example of a case where properties appear to change more than once per day might be the AM/PM day use passes for a day use area like Cheakamus. For the same 'assets' (parking spaces), the policies change during the day (AM capacity is only available in the morning, PM only in the afternoon). In this case, AM and PM offerings should be broken into their own products, such that each day has 2 offerings (AM or PM) but the properties of either do not change throughout the day (AM window is from 7am-12pm/1pm, PM window is from 12pm/1pm-dusk). Importantly, the assets and the durations they are offered for (inventory) managed by each product **have no overlap**.

## Calendar
A calendar is a data concept that allows for more granular control over the properties of a [product](#product) over a fixed period of time. It allows for system administrator to change how a product is offered on a predefined schedule if a product's properties change depending on the date, day of week, season, etc. 

At its core, a calendar contains a start date, an end date, and a [schedule](#schedule-properties) that contains any deviations from the base product properties that occur on any day in between the start and end dates. The schedule properties on a given day will overwrite the base product properties on that given day. 

Once a calendar is defined, the `buildSchedule` function can be run with the API to build out the calendar into [one product item for every day](#specific-date-product-properties) it is offered between the start date and end date. These date-specific products will be what the user looks at to determine day-to-day availability of a certain product. They are analogous to the `reservations` object used in Day Use Pass. For every date between the start and end date inclusive, the `buildSchedule` function looks for that date in the calendar schedule. If the calendar contains changes on that date, the date-specific product item will contain those changes (essentially overwriting the base product properties). In cases where properties are not changed by the calendar, or where dates are not present in the calendar, the base product properties will be copied into the date-specific product.

The overwrite currently is just a basic object merge with the schedule properties taking precedence over the base product. 

For example, some day use passes are only offered on weekends and holidays. In this case, the base product properties would define what the day use offering is like on the weekends and holidays. The calendar would contain the start and end date for the season, and a schedule where every non-holiday weekday has `isPermitRequired: false`. When the schedule is built, only dates where `isPermitRequired: true` will be built into date-specific products. 

### Calendar Properties
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|calendar::\<orcs>::\<activityType>::\<activityId>|'calendar::7::dayuse::1'|
|sk|`String`|\<productId>::\<startDate>|'1::2024-12-10'|
|orcs|`Number`|The ORCS number of the parent protected area|7|
|schema|`String` or `Enum`|The schema/data type (meta)|'calendar'|
|activity|`String`|Parent activity `sk`|'dayuse::1`|
|activityId|`Number`|ActivityId of the parent activity|1|
|activityType|`String` or `Enum`|The activity type (meta)|'dayuse'|
|startDate|`ISODate`|The start date of the calendar|2024-12-10|
|endDate|`ISODate`|The end date of the calendar|2025-02-15|
|schedule|`Schedule`|See [schedule properties](#schedule-properties)|{Schedule}|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

### Schedule Properties
A schedule is a complex object where each key is an `ISODate` between `startDate` and `endDate`. If the base product properties deviate on an `ISODate`, the property with that `ISODate` key contains a sub-object with all the deviations.

**Example**
```
schedule: {
	2024-12-12: {
		isPermitRequired: false;
	},
	2024-12-13: {
		isPermitRequired: false;
	},
	2024-12-15: {
		baseCapacity: 250;
		description: 'Base capacity changed to account for expected change in demand to visit this facility';
	}
	
}
```
## Timezones
BC has [4 timezones](https://en.wikipedia.org/wiki/Time_in_Canada#/media/File:Canada_time_zone_map_-_en.svg):
|**Abbreviation**|**IANA String**|
|---|---|
|`PST/PDT`|`America/Vancouver`|
|`MST/MDT`|`America/Edmonton`|
|`MST`|`America/Fort_Nelson`|
|`MST`|`America/Creston`|
All reservations are currently done in `America/Vancouver` regardless of location.
`America/Creston` is rarely used and can be interchanged with `America/Fort_Nelson` since they share the same patterns.

# Users
Some projected user properties for users of all types within the system.
### User Contact Information
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|user::\<userId>|'user::745y2934927374'|
|sk|`String`|'information'|'information'|
|userId|`String`|Unique user id, likely generated by cognito|'745y2934927374'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'userInfo'|
|userName|`String`|Display name for the user|'Bruce Wayne'|
|role|[`Enum`](#user-role-enums)|The permissions role of the user| 'public'|
|email|`String`|User contact email|'bruce@waynetech.com'|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

### User Booking History
|**Property Name**|**Property Type**|**Definition**|**Example**|
|---|---|---|---|
|pk|`String`|user::\<userId>|'user::745y2934927374'|
|sk|`String`|'bookings::\<year>'|'bookings::2024'|
|year|`Number`|Year of interest|2024|
|userId|`String`|Unique user id, likely generated by cognito|'745y2934927374'|
|schema|[`Enum`](#schema-enums)|The schema/data type (meta)|'userBookings'|
|bookings|`[PrimaryKey]`|An array of booking keys to date of the year of interest|[]|
|version|`Number`|Data revision (meta)|1|
|creationDate|`DateTime`|Timestamp of original data creation in UTC (meta)|`2024-11-15T00:00:000Z`|
|lastUpdated|`DateTime`|Timestamp of last update in UTC (meta)|`2024-11-15T00:00:000Z`|

# ENUMs
#### Schema ENUMs
```
protectedArea
geozone
facility
activity
product
asset
policy
permit
calendar
userInfo
userBookings
```
#### Timezone ENUMs
See [timezones](#timezones).
```
America/Vancouver
America/Edmonton
America/Fort_Nelson
America/Creston
```

#### FacilityType ENUMs
```
campground
parking
trail
boatLaunch
cabin
```

#### ActivityType ENUMs
```
frontcountryCamp
backcountryCamp
groupCamp
dayuse
boating
cabinStay
canoe
```

#### SubActivityType ENUMs
```
// frontcountryCamp
campsite
walkin
rv

// backcountryCamp
reservation
passport

// groupCamp
*N/A*

// dayuse
vehicleParking
trailUse
shelterUse
saniUse
showerUse
elecUse

// boating
dockMooring
buoyMooring

// cabin
frontcountry
backcountry

// canoe
portionCircuit
fullCircuit
```
#### Season ENUMs
```
regular
offSeason
summer
winter
fall
spring
```
#### Inventory AllocationTypes ENUMs
```
flex
fixed
```
#### Facility Status ENUMs
```
open
closed
```

#### AssetType ENUMS
```
// likely important for reservations
campsite
rvSite
trailCapacityUnit
parkingStall
parkingStallTrailer
bunk
picnicShelter

// less important but still may be used in the future
gatehouse
picnicTable
fireRing
toilet
outhouse
potableWaterSource
foodCache
```
#### PolicyType ENUMs
```
booking
fee
change
party
```
#### Reservation Window Type ENUMs
```
rolling
fixed
```
#### User Role ENUMs
```
superadmin
public
```
# API Endpoints
Subject to change while AWS CDK is implemented over the existing SAM template generated endpoints.
## Protected Areas
#### GET All Protected Areas
Gets all protected areas in the system. 
```
GET /protected-areas
```
**Returns:** all protected areas in the system.

#### GET Specific Protected Area
Gets a specific protected area in the system.
```
GET /protected-areas/<orcs>
GET /protected-areas?orcs=<orcs>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the protected area.|

**Returns:** A single specific protected area with the ORCS `<orcs>`.

## Subareas ( to be changed to GeoZones)
#### GET Subareas by ORCS
Gets all subareas that are linked to a specific ORCS (all subareas within a specific park).
```
GET /subareas?orcs=<orcs>
GET /protected-areas/<orcs>/subareas
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|

**Returns:** All subareas linked to the protected area with the ORCS `<orcs>`.

#### GET Specific Subarea
Gets a specific subarea within a specific park.
```
GET /subareas?orcs=<orcs>&subareaId=<subareaId>
GET /protected-areas/<orcs>/subareas/<subareaId>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|
|`subareaId`|The subarea ID of the subarea|

Optional query parameters:
|parameter|description|
|---|---|
|`fetchFacilities`|Fetches the list of facilities defined by the facility `sk`s in the `facilities` property of the subarea. The `facilites` property is overwritten with the list of facilities when returning the subarea. Gets the facilities of the subarea in the same call as the subarea GET, but is equally resource intensive as doing individual facility GETs by subarea.|
|`fetchActivities`|Fetches the list of activities defined by the activity `sk`s in the `activities` property of the subarea. The `activities` property is overwritten with the list of activities when returning the subarea. Gets the activities of the subarea in the same call as the subarea GET, but is equally resource intensive as doing individual activity GETs by subarea.|

**Returns:** A single subarea identified by its subarea ID and the ORCS of its parent protected area.

#### POST Subarea
Creates a brand new subarea within the provided protected area. Creating a brand new subarea will automatically assign the next logical `subareaId` to the newly created subarea. 
```
POST /subareas?orcs=<orcs>
POST /protected-areas/<orcs>/subareas
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|

Optional POST body parameters (see [subarea](#subarea)):
```
displayName
description
isVisible
searchTerms
envelope
location
```
**Returns:** The details of the newly created subarea.  

#### PUT Subarea
Updates an existing subarea.
```
PUT /subareas?orcs=<orcs>&subareaId=<subareaId>
PUT /protected-areas/<orcs>/subareas/<subareaId>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|
|`subareaId`|The subarea ID of the subarea|

Optional PUT body parameters (see [subarea](#subarea)):
```
displayName
description
isVisible
searchTerms
envelope
location
version (if serial updating is enforced)
```
Adding facilities and activities to subareas will be handled by a separate endpoint to ensure proper linkage between data types. 
**Returns:** Success/Failure message.

## Facilities
#### GET Facilities by ORCS
Gets all facilities that are linked to a specific ORCS (all facilities within a specific park).
```
GET /facilities?orcs=<orcs>
GET /protected-areas/<orcs>/facilities
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|

**Returns:** All facilities linked to the protected area with the ORCS `<orcs>`.

#### GET Facility by ORCS and Facility Type/ID
Gets a specific facility by ORCS, facility type, and facility ID.
```
GET /facilities?orcs=<orcs>&facilityType=<facilityType>&facilityId=<facilityId>
GET /protected-areas/<orcs>/facilities/<facilityType>/<facilityId>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|
|`facilityType`|The type of facility (trail, parking, campground, etc)|
|`facilityId`| Facility identifier|

Optional query parameters:
|parameter|description|
|---|---|
|`fetchActivities`|Fetches the list of activities defined by the activity `sk`s in the `activities` property of the facility. The `activities` property is overwritten with the list of activities when returning the facility. Gets the activities of the facility in the same call as the facility GET, but is equally resource intensive as doing individual activity GETs by facility.|

**Returns:** A single facility with `orcs`, `facilityType` and `facilityId`

## Activities
#### GET Activities by ORCS
Gets all activities that are linked to a specific ORCS (all activities within a specific park).
```
GET /activities?orcs=<orcs>
GET /protected-areas/<orcs>/activities
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|

**Returns:** All facilities linked to the protected area with the ORCS `<orcs>`.

#### GET Activity by ORCS and Activity Type/ID
Gets a specific activity by ORCS, activity type, and activity ID.
```
GET /activities?orcs=<orcs>&activityType=<activityType>&activityId=<activityId>
GET /protected-areas/<orcs>/activities/<activityType>/<activityId>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|
|`activityType`|The type of activity(camping, dayuse, etc)|
|`activityId`| Activity identifier|

Optional query parameters:
|parameter|description|
|---|---|
|`fetchFacilities`|Fetches the list of facilities defined by the facility `sk`s in the `facilities` property of the activity. The `facilities` property is overwritten with the list of facilities when returning the activity. Gets the facilities of the activity in the same call as the activity GET, but is equally resource intensive as doing individual facility GETs by activity.|

**Returns:** A single activity with `orcs`, `activityType` and `activityId`.

#### GET Products by Activity
Gets a list of products associated with an activity.
```
GET /products?orcs=<orcs>&activityType=<activityType>&activityId=<activityId>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|
|`activityType`|The type of activity(camping, dayuse, etc)|
|`activityId`| Activity identifier|

**Returns:** A list of products belonging to the activity with `orcs`, `activityType` and `activityId`.

#### GET Product by ORCS, Activity and ProductId.
Gets a specific product by ORCS, activity type, activity ID and product ID.

```
GET /products?orcs=<orcs>&activityType=<activityType>&activityId=<activityId>&productId=<productId>
```
|parameter|description|
|---|---|
|`orcs`|The orcs number of the parent protected area.|
|`activityType`|The type of activity(camping, dayuse, etc)|
|`activityId`| Activity identifier|
|`productId`| Product identifier|

Optional query parameters:

|parameter|description|
|---|---|
|`fetchPolicies`|Fetches the list of policies (`booking`, `fee`, `change` and `party`) defined by the policy `sk`s in the `bookingPolicy`, `feePolicy`, `changePolicy` and `partyPolicy` properties of the product. The `bookingPolicy`, `feePolicy`, `changePolicy` and `partyPolicy` properties are overwritten with the full policies when returning the product. Gets the policies of the product in the same call as the product GET, but is equally resource intensive as doing individual policy GETs by product.|
|`fetchSchedule`|Fetches a portion of the product schedule between a range of dates. If `startDate` is also provided with the call, the schedule date for just that single date is returned. If `startDate` and `endDate` are provided with the call, all the schedule dates between `startDate` and `endDate` inclusive are also provided with the call. If neither `startDate` nor `endDate` are provided, the current date is determined and a window of predetermined length (default is 2 weeks) is returned with the call. Gets the schedule of the product in the same call as the product GET, but is equally resource intensive as doing individual product schedule date GETs.|
|`startDate`|The specific date of the product schedule to return or the start of a range of dates to return. In `ISODate` format (YYYY-MM-DD). Timezone is determined by the facility where the product is offered.|
|`endDate`|The end of a range of dates to return. Argument `startDate` must also be provided. In `ISODate` format (YYYY-MM-DD). Timezone is determined by the facility where the product is offered.|



