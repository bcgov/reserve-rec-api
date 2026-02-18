# Activities

An activity represents a specific type of experience offered by BC Parks. Activities describe what a visitor can do and are anchored to specific places. They form the core of the intent context in this data model. They have semantic meaning in the generalized experience type they define, and spatial meaning without embedding themselves with spatial data and context.

Activities are defined by
- the type of experience (e.g., day‑use, camping, backcountry, boating), and
- a relationship to a region or location where that experience is offered.

If more than one activity of the same type is offered within the same collection, they are disambiguated using an atomically incrementing identifier (e.g., 1, 2, 3).

Examples of activity types include:
- Camping (frontcountry, backcountry, group)
- Cabin use (frontcountry, backcountry)
- Day‑use (parking, trail access, picnic shelters)
- Boat launching
- Canoe circuits

Activities are not tied to any legacy BC Parks concept; they are a distinct datatype within this model.

## Relationship to Facilities and Geozones

Activities, facilities and geozones form many‑to‑many relationship. A single facility or geozone may support several activities, and an activity may span multiple facilities and/or geozones. However, every activity must be associated with at least one facility or geozone, since an activity represents an experience that must occur at a physical location.

Activities, facilities and geozones exist at roughly the same level of the data hierarchy, but they represent different user search path
- Geozones answer: "Where do you want to go (roughly)?"
- Facilities answer: “Where do you want to go? (exactly)”
- Activities answer: “What do you want to do? (by looking at ActivityType)”

Users may approach their searches by using either structure:
### Location‑first example
“I want to go to Alouette Lake South Beach.”
→ The facility shows the user which activities are available there (day‑use parking, boat launching).
### Experience‑first example
“I want to go backcountry camping (in Cape Scott or some other refined geospatial region such as the extents of a map on screen)”
→ The activity shows the user which Cape Scott facilities/geozones support backcountry camping.

ActivityTypes (activity property) assist in an even broader search type - they group together similar experiences that transcend locations. A user could ask a broader experience-first question:

### Broad experience-first example
"I want to go backcountry camping (anywhere)"
→ The system could pull a list of activities filtered by activityType = backcountry camping, but this list could be large so query limits should be in effect.

## Role in the Booking Flow
Activities are the primary entry point into the booking system. Once a user selects an activity, the system can guide them to:
- the relevant facilities
- the available products
- the specific dates that activity/product is available (ProductDates)
- the inventory and booking rules

Activities are therefore the bridge between what the user wants to do and the specific reservable offerings (products).

## Example: What an Activity Represents

**Bedwell Lakes Backcountry Camping** is an activity. It carries semantic meaning because it belongs to the broader category of *backcountry camping opportunities*, a type of experience that comes with well-understood assumptions, expectations, and governance rules. However, the activity is not just an instance of that category. It is also **anchored to the Bedwell Lakes Area**, and therefore represents the specific backcountry experience associated with that place.

This means the activity inherits the overarching themes of *backcountry camping opportunities* but remains its own distinct experience within the BC Parks system. It describes *what the experience is*, not *whether it is currently offered*.

Looking up this activity at different times of year does not affect what a visitor would see. The activity is stable and conceptual. If the visitor wants to know **when** they can take advantage of this experience, they must look deeper into the operational layer (products and productDates). The activity simply answers the question:

**"Are there ever backcountry camping opportunities at Bedwell Lakes?"**

## Spatial Relationships

Activities are partially defined by a relationship to spatial entities (geozones and/or facilities), but do not contain spatial data themselves. This relationship forms part of the bidirectional many-to-many graph outlined in the user's [Discovery Phase](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---2.-Contexts#discovery-phase).

# Properties
Note: The activity configuration file is the authoritative source for the current schema.

| **Property**        | **Type**            | **Description** |
|---------------------|---------------------|-----------------|
| `pk`                | String        | Partition key for the item. Always begins with `activity::<collectionId>`. Groups all activities within a collection. |
| `sk`                | String              | Sort key uniquely identifying the item within the partition. Typically a combination of `activityType` and `identifier` |
|`schema`|String|Item datatype/schema. Will always be 'activity' for activities|
| `globalId`          | String| UUID used for GSIs and cross‑collection lookups. |
| `collectionId`      | String              | Identifier linking the activity to its operational collection (e.g., `bcparks_1`). |
| `activityId`|Number| Identifier uniquely distinguishing this particular activity from other activities of the same type within the same collection|
| `identifier`|Number| See `activityId`|
| `activityType`|String|The type of activity the item represents. Some examples include "frontcountryCamp", "backcountryCamp", and "groupCamp"|
| `activitySubType`|String|If needed, a further categorization of the `activityType`. Some examples of a "dayuse" `activitySubType` include "trailUse" or "shelterUse"|
| `displayName`              | String              | Human‑readable name of the item. |
| `description`       | String              | Optional descriptive text explaining the purpose or operational meaning of the item. |
|`imageUrls`|[String]|Array of urls of images of this data item|
|`timezone`|String|The IANA string timezone of the spatial data item|
|`isVisible`|Boolean|Whether or not this item will be returned if it generates a search hit|
| `creationDate`|DateTime|Timestamp of when the item was first created|
| `lastUpdated`|DateTime|Timestamp of when the item was last updated|
|`version`|Number|Data revision number|
|`searchTerms`|String|Comma-separated list of terms OpenSearch can use to link text searches to this data item|
|`adminNotes`|String|Administrative notes to describe the data, will never be surfaced to the public|

# Examples
how to include mermaid charts in mkdocs - do i install mermaid2
## Bedwell Lake Backcountry Camping
```json
--8<-- "datatypes/examples/activity1.json"
```

This activity would relate to a Bedwell Lakes Area geozone, the Bedwell and Baby Bedwell Lakes Campgrounds, and other spatial entities that support the Bedwell Lakes Backcountry Camping experience.