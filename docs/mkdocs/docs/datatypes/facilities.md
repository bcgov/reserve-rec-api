# Facilities

A facility is a specific, physical feature represented by a geographic point, polyline, or polygon. Facilities describe real‑world infrastructure or natural features that visitors interact with directly. They typically include man-made structures such as: parking lots, campgrounds, trailheads, buildings, and viewpoints, but they may also represent natural features such as lakes, beaches or mountains when those features are meaningful to the user experience.

A single facility may support zero, one, or many activities, and users may require permission to visit, stay at, or otherwise use certain facilities.

Facilities provide parental groupings for [assets](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---7.-Inventory-and-Assets#assets), which are the smallest spatial elements in the system.

Although facilities may resemble legacy BC Parks concepts, they are a distinct datatype within this data model and are not derived from any preexisting structure.

## Relationship to Geozones
Facilities and geozones are both spatial concepts, but they serve different purposes:
- Facilities represent physical objects or specific locations.
- Geozones represent conceptual regions that group multiple facilities, activities, or features.

Even when a facility uses a polygon to describe its footprint, it remains a physical feature, not a regional grouping.
This distinction keeps the spatial model clear, scalable, and easy to reason about.

Like geozones, facilities can be:
- system‑defined (BC Parks infrastructure)
- user‑defined (personal points or areas of interest)

Because facilities may belong to different audiences, they are grouped using `collectionIds`.
- A facility in Strathcona Park (ORCS 1) → facility::bcparks_1

# Properties
Note: The facility configuration file is the authoritative source for the current schema.

| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
| `pk`                | String        | Partition key for the item. Always begins with `facility::<collectionId>`. Groups all facilities within a collection. |
| `sk`                | String              | Sort key uniquely identifying the item within the partition. Typically a combination of `facilityType` and `identifier` |
|`schema`|String|Item datatype/schema. Will always be 'facility' for facilities|
| `globalId`          | String| UUID used for GSIs and cross‑collection lookups. |
| `collectionId`      | String              | Identifier linking the facility to its operational collection (e.g., `bcparks_1`). |
| `facility`|Number| Identifier uniquely distinguishing this particular facility from other facilities of the same type within the same collection|
| `identifier`|Number| See `facilityId`|
| `facilityType`|String|The type of facility the item represents. Some examples include "campground", "accessPoint", and "naturalFeature"|
| `facilitySubType`|String|If needed, a further categorization of the `facilityType`. Some examples of a "naturalFeature" might include a "lake", "summit" or "waterfall"|
| `displayName`              | String              | Human‑readable name of the item. |
| `description`       | String              | Optional descriptive text explaining the purpose or operational meaning of the item. |
| `envelope`          | OSGeo   | Bounding box containing 2D spatial geometry, if it exists.  |
| `boundary`|OSGeo|Spatial footprint geometry, if it exists and small enough to be stored in DynamoDB.|
| `boundaryUrl`       | String  | Spatial footprint geometry, if it exists. Stored in S3 with a reference URL. |
|`location`|OSGeo|Geospatial point serving as the location of the facility, used for search relevance, sorting, clustering, and map pin placement|
|`path`|OSGeo| Spatial polyline geometry, if it exists and small enough to be stored in DynamoDB. Usually will refer to a trail or road. |
|`pathUrl`|String| Spatial polyline geometry, if it exists. Stored in S3 with a reference URL.|
|`minMapZoom`|Number|The smallest zoom level (furthest zoomed out) at which the object will render on a map if it is not in focus|
|`maxMapZoom`|Number|The largest zoom level (furthest zoomed in) at which the object will render on a map if it is not in focus|
|`imageUrls`|[String]|Array of urls of images of this data item|
|`timezone`|String|The IANA string timezone of the spatial data item|
|`isVisible`|Boolean|Whether or not this item will be returned if it generates a search hit|
| `creationDate`|DateTime|Timestamp of when the item was first created|
| `lastUpdated`|DateTime|Timestamp of when the item was last updated|
|`version`|Number|Data revision number|
|`searchTerms`|String|Comma-separated list of terms OpenSearch can use to link text searches to this data item|
|`adminNotes`|String|Administrative notes to describe the data, will never be surfaced to the public|

# Examples

## Bedwell Lake Campground

```json
--8<-- "datatypes/examples/facility1.json"
```

## Juan de Fuca Trail
```json
--8<-- "datatypes/examples/facility2.json"
```




