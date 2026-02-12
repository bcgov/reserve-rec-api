# Geozones

A geozone is a system‑defined spatial region used to group interrelated facilities, activities, and other geolocated data. Its defining feature is a geospatial polygon or bounding box that describes the physical boundary of the geozone. Geozones represent operational or experiential areas of interest — not legal boundaries — and provide a flexible way to describe geospatial regions meaningfully without the context of preexisting datatypes, such as parks/protected areas/subareas.

Protected areas can be extremely large and often contain vast regions with no visitor‑facing features. Geozones allow the system to focus on the specific areas that matter to users and administrators.

Geozones vary in size, but each one is designed to:
- group features that are meaningfully related
- be viewable on a single map without losing spatial clarity
- accurately convey proximity, distance, and relationships
- support rich search, discovery, and navigation experiences

## Public Use Cases
Geozones can represent visitor‑facing experiences such as:
- “Bedwell Lakes” within Strathcona Park
- “Cheakamus Lake Area” within Garibaldi

A geozone can serve as a landing zone for search queries (e.g., a user searching “bedwell” can be routed directly to the Bedwell Lakes geozone, even though it is only a subregion of Strathcona Park).

## Administrative Use Cases
Geozones can also group features that share:
- operational responsibilities
- maintenance bundles
- management workflow

This allows staff to work with meaningful operational regions (bundles) rather than legal park boundaries.

## Custom User-Defined Geozones
Authenticated users may define their own geozones for personal use — for example, marking a favourite backcountry loop or a region they frequently monitor. These user‑defined geozones live in their own collections and do not affect public or administrative geozones.

## DynamoDB Partitioning
Geozones use a compound primary key:

```
pk: geozone::<collectionId>
sk: <geozoneId>
```


Example — BC Parks geozone relating to Garibaldi Provincial Park (ORCS 7)
```
pk: geozone::bcparks_7
sk: 1
```

Querying this partition returns all geozones associated with the Garibaldi collection, enabling front‑end applications to build spatially meaningful home pages and navigation flows.

Example — User‑Defined Geozone
pk: geozone::user_12345
sk: 1


High cardinality of `collectionId` ensures DynamoDB performance remains stable regardless of the number of geozones in the system.

# Properties

Note: The geozone configuration file is the authoritative source for the current schema.

| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
| `pk`                | String        | Partition key for the geozone. Always begins with `geozone::<collectionId>`. Groups all geozones within a collection. |
| `sk`                | String              | Sort key uniquely identifying the geozone within the partition. Typically `geozoneId` |
|`schema`|String|The datatype/schema. Will always be 'geozone' for geozones|
| `globalId`          | String| UUID used for GSIs and cross‑collection lookups. |
| `collectionId`      | String              | Identifier linking the geozone to its operational collection (e.g., `bcparks_1`). |
| `geozoneId`|Number| Identifier uniquely distinguishing this particular geozone from other geozones within the same collection|
| `identifier`|Number| See `geozoneId`|
| `displayName`              | String              | Human‑readable name of the geozone. |
| `description`       | String              | Optional descriptive text explaining the purpose or operational meaning of the geozone. |
| `envelope`          | OSGeo   | Bounding box containing authoritative spatial geometry.  |
| `boundary`|OSGeo|Authoritative spatial geometry, if it fits in DynamoDB.|
| `boundaryUrl`       | String  | Authoritative spatial geometry. Stored in S3 with a reference URL. |
|`location`|OSGeo|Geospatial point serving as a simplified point used for search relevance, sorting, clustering, and map pin placement|
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

## Bedwell Trail Area

This geozone might be used to encompass the limits of the Bedwell Trail Area, showing the boundary of the backcountry area and the backcountry camping sites contained within.

```json
--8<-- "datatypes/examples/geozone2.json"
```

## Strathcona Provincial Park

This example geozone shows how a park may be represented as a special kind of geozone. An additional field `orcs` pertaining to the ORCS ID, or some other field signifying this special geozone case, could be added if absolutely necessary.

```json
--8<-- "datatypes/examples/geozone1.json"
```

# Protected Areas

Also known as 'parks', these datatypes were the backbone of older systems and are uniquely defined by the legally designated ORCS number assigned to each protected area. The concept of a 'park' or 'protected area' is shared by several areas of BC Parks so the definition used in this model is analogous to those pre-understood concepts.

However, because the preexisting concept of a protected area is rooted in its legal definition, it is unable to change to accommodate the wide range of use cases this data model demands. This makes the protected area datatype a poor candidate for the backbone of this model.

[Collections](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---1.-Introduction#collections) remain the backbone of the data model, and [geozones](#geozones) remain the datatype at the very top of the data hierarchy. Protected areas can be represented as a subset of geozones and linked to collections as necessary to maintain continuity with historical systems or regulator requirements. See the [Strathcona Provincial Park](#strathcona-provincial-park) example of how this might be achieved.




