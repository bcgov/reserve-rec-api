# Collections and Collection IDs

Historically, the reservation system used parks (protected areas) as the highest level of data categorization. Parks are uniquely identified by their ORCS number — a legally defined identifier managed by an external authority.

This approach has proven too restrictive for a modern reservation system:
- ORCS values cannot be created, modified, or merged by the system.
- ORCS boundaries do not always align with real‑world experiences.
- Some offerings span multiple parks or only portions of parks

### Example - Desolation Sound
Desolation sound contains in part a single backcountry registration offering that spans multiple protected areas:
* Desolation Sound Park (ORCS 252)
* Malaspina Park (ORCS 6268)
* Cope Islands Park (ORCS ???)
* Roscoe Bay Park (ORCS 373)

Under an ORCS-centric model, this experience cannot be represented cleanly.

## Collections

To regain control of the data hierarchy, this data model introduces **collections**.

A **collection** is the highest-level grouping of interrelated experiences in this data model. They are defined by **operational reality**, not legal boundaries.

A collection may include:
* one park
* multiple parks
* partial areas of parks
* areas that are not parks at all

This gives the system full flexibility to represent real‑world experiences without being constrained by external legal definitions.

It is still possible to group experiences analogously to preexisting understandings where the protected area is the backbone of the grouping, like this example of Strathcona Park's BC Parks Collection:

<img width="810" height="796" alt="image" src="https://github.com/user-attachments/assets/1505bf78-8008-4933-94f2-b47d91451dd2" />

With collections, we can also represent the aforementioned [Desolation Sound](#example---desolation-sound) scenario as shown in the following image.

<img width="900" height="602" alt="image" src="https://github.com/user-attachments/assets/a5f6f82c-711b-48d5-a4be-0d9113adcd1b" />

## Collection IDs
A **collectionId** uniquely identifies a collection.

It does not need to follow any external standard - it only needs to be stable and unique, and be free of URL-reserved characters as they often appear in API paths.

For collections that relate to BC Parks and the experiences offered by BC Parks, the convention is

```
bcparks_<ORCS>
```

### Examples:
* Strathcona Park (ORCS 1) => `bcparks_1`
* A multi-park collection could be => `bcparks_252` or `bcparks_252_6268_373`

Collection IDs are used extensively in **reference data** to group related items across multiple schemas, ensuring that all data associated with a shared experience domain can be queried and reasoned about consistently.

It is important to note:

<h3>Collections are *not* a datatype (yet).</h3>

They do not represent a schema, entity, or object in the data model.

They are purely labels used to associate related reference‑data items.

(In the future, they may need to be converted to a datatype to include collection metadata, like a collection `displayName`).