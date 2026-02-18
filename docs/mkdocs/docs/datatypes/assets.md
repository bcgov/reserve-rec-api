# Assets

Assets represent persistent, non-temporal physical or conceptual objects that can eventually become [inventory](#inventory) when paired with a product/productDate. They are the "things" BC Parks manages that exist independently of time. They have spatial context as they are operationally tied to one place - a facility.

An asset
* always exists
* does not change based on time (daily, seasonally, annually, etc)
* is NOT reservable on its own
* belongs to a parent facility
* becomes reservable only when paired with a product that makes it available on specific dates.

Assets are the foundation for *fixed inventory* (physical assets like specific tentpads) and the conceptual anchor for *flex inventory* (conceptual assets like trail capacity).

## Assets vs Inventory
*Asset* = the persistent object
*Inventory* = the asset *on a specific date*

Example:
- *Asset*: Tentpad #43 at Rathtrevor Beach
- *Inventory*: Tentpad #43 on 2024‑08‑15

The tentpad exists all year, but it only becomes reservable as inventory when a product defines
- when it is available
- how it is governed
- how many exist (in flex asset cases)

The separation keeps the system clean: assets define *what exists*, while products/productDates and inventory define *when it is reservable* and *how it behaves*.

Assets allow the system to:
- represent physical infrastructure (campsites, cabins, parking stalls)
- represent conceptual capacity (trail day‑use slots, backcountry tentpad counts)
- attach metadata (location, images, amenities)
- supplement map rendering
- supplement search and discovery
- support future features like asset‑level analytics or maintenance tracking

Assets are not created or destroyed seasonally — they persist even when the experience is closed or otherwise unavailable.

## Example: Turning an asset into inventory
A tentpad exists year‑round, but the campground is only open May–September.
- Asset: Tentpad #43
- Product: “Rathtrevor Beach Camping – Regular Site”
- ProductDate: All dates from May 1 to September 30
- Inventory: Tentpad #43 on each of those dates

The Product is what “activates” the asset for a specific season.

# Properties

## Assets

| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
| `pk`                | String        | Partition key for the item. Always begins with `asset::<collectionId>::<facilityType>::<facilityId>`. Groups all assets that belong to a facility. |
| `sk`                | String              | Sort key uniquely identifying the item within the partition. Typically just `<assetType>::<assetId>` |
|`schema`|String|Item datatype/schema. Will always be 'product' for products|
| `globalId`          | String| UUID used for GSIs and cross‑collection lookups. |
| `collectionId`      | String              | Identifier linking the asset to its operational collection (e.g., `bcparks_1`). |
| `facilityType`|String| Parent `facilityType`|
|`facilitySubType`|String| Parent `facilitySubType`, if available|
|`facilityId`|String| Parent `facilityId`|
|`assetType`|String| Type of asset|
|`assetId`|String|Identifier uniquely distinguishing this particular asset from other assets of the same type within the same partition|
| `identifier`|Number| See `assetId`|
| `displayName`              | String              | Human‑readable name of the item. |
| `description`       | String              | Optional descriptive text explaining the purpose or operational meaning of the item. |
|`location`|OSGeo| Asset geospatial centroid|
|`minMapZoom`|Number|The smallest zoom level (furthest zoomed out) at which the object will render on a map if it is not in focus|
|`maxMapZoom`|Number|The largest zoom level (furthest zoomed in) at which the object will render on a map if it is not in focus|
|`imageUrls`|[String]|Array of urls of images of this data item|
|`gsipk`|String|GSIPK - for assets, this is the `pk` of the parent facility|
|`gsisk`|String|GSISK - for assets, this is the `sk` of the parent facility|
|`isVisible`|Boolean|Whether or not this item will be returned if it generates a search hit|
|`creationDate`|DateTime|Timestamp of when the item was first created|
|`lastUpdated`|DateTime|Timestamp of when the item was last updated|
|`version`|Number|Data revision number|
|`searchTerms|String|Comma-separated list of terms OpenSearch can use to link text searches to this data item|
|`adminNotes`|String|Administrative notes to describe the data, will never be surfaced to the public|

Assets may have many properties unique to their `assetType`. Some examples follow for a campsite `assetType`:

| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
|`assetGroupIds`|[String]|Future consideration, if assets need further grouping mechanisms beyond what their parent facility and collection allow for|
|`siteNumber`|Number|The number of the campsite in the campground|
|`siteType`|String|Type of campsite, if differentiation is useful. Examples: "regular", "walk-in", "rv"...|
|`hasSani`|Boolean|Whether or not the site has a sanitary hookup|
|`hasElec`|Boolean|Whether or not the site has an electrical hookup|
|`onCampgroundPerimeter`|Boolean|Whether or not the campsite is on the edge of the campground (typically more popular)|
|`onShoreline`|Boolean|Whether or not the campsite is on the edge of a lake, river, the ocean, etc.|
|`metersToPotWater`|Number|Distance in meters to nearest source of potable water|
|`metersToToilet`|Number|Distance in meters to the nearest toilet|
|`metersToShower`|Number|Distance in meters to the nearest shower|
|`area`|Number|Square meterage of the site|

... and many more properties. These can be useful to help users narrow down exactly what they are looking for once they select a campground.

```json
--8<-- "datatypes/examples/asset1.json"
```





