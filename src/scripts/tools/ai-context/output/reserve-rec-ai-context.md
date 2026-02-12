# Reserve Rec Context Document for AI Consumption

Generated: 2026-01-06T20:13:34.059Z

Repository: https://github.com/bcgov/reserve-rec-api

---

## Data-Model

Written: 2024-11-15 Updated: 2025-12-30 Author: Team Osprey

# Reservations Data Model — Summary
The PRDT data model is the foundation that allows BC Parks to offer any kind of outdoor experience — from campsites to cabins, trail passes, backcountry permits, parking, and future offerings we haven’t imagined yet. It’s designed to be flexible, scalable, and easy to maintain as park operations evolve.

At its core, the model separates **where** an experience happens, **what** the experience is, **when** it’s available, **how** it’s governed, and **who** is interacting with it. By keeping these ideas separate, the system can adapt to new experience types, new rules, and new geographies without major redesign.

## Why This Model Exists
BC Parks manages a huge variety of experiences. Most are contained entirely within parks - but some span multiple parks, and some only cover part of a park. Experiences also change seasonally, depend on geospatial boundaries, and require different rules or capacities.

The data model provides a unified structure that can represent all of these cases consistently — even as offerings grow or change.

## [Collections — The Top‑Level Grouping](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---1.-Introduction#collections-and-collection-ids)
Instead of using legally defined park boundaries (ORCS numbers), the system uses collections — flexible groupings that reflect real‑world operational needs.
A collection may include:
- one park
- multiple parks
- part of a park
- areas that aren’t parks at all

Collections are not a schema or entity (yet) — they’re labels used to group related reference data so the system can reason about an experience domain consistently.

<img width="829" height="813" alt="image" src="https://github.com/user-attachments/assets/0a15575f-6dde-41f7-8195-acf0097b1c82" />

## [Important Datatypes](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---1.-Introduction)
- [Geozones](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---3.-Geozones) - defined spatial boundaries that group assets or regions together so products, rules, and availability can be applied consistently across a specific geographic area.
- [Facilities](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---4.-Facilities) - specific, physical elements that describe real-world infrastructure or natural features that visitors interact with directly. 
- [Activities](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---5.-Activities) - generalized recreational opportunities - such as camping or trail use - that describe what experiences are potentially available to visitors without factoring in when they are actually available or which reservation policies apply.
- [Products](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---6.-Products-and-ProductDates)  (WIP) - reservable offerings that define what is being booked along with the general policies and other operational parameters that govern how it can be reserved
- [ProductDates](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---6.-Products-and-ProductDates) (WIP) - fully resolved, day-specific configurations of a product that combine the governing policies into a single authoritative snapshot for that date.
- [Assets](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---7.-Inventory-and-Assets) (WIP) - persistent logical units - usually physical but sometimes conceptual - that represent something whose ownership or allocation can change day-to-day. The non-temporal part of **inventory**.
- [Inventory](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---7.-Inventory-and-Assets) (WIP) - date-specific availability records for an asset, representing the smallest unit of reservable capacity and serving as the concurrency boundary for bookings. 
- [Policies](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---8.-Policies) (WIP) - define the rules and conditions that govern how a product can be reserved or modified. 
- Users (WIP) - Individuals who interact with the system, carrying identity, roles, and permissions that shape what they can see or do.
- [Bookings](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---9.-Bookings-and-Transactions) (WIP) - Records that formalize a user’s commitment to a specific offering by allocating inventory under the governing policies.
- [Transactions](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---9.-Bookings-and-Transactions) (WIP) - Financial records that capture the payment events associated with creating, modifying, or canceling a booking or multiple bookings.
- [(Protected areas)](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---3.-Geozones#protected-areas) - a legacy datatype representing a legally-defined park unit, represented in this model as a specialized geozone rather than its own datatype. 

<img width="928" height="1387" alt="reservations_data_model-Base Model drawio" src="https://github.com/user-attachments/assets/83661e00-64c9-47fc-a361-a7aba48eb3de" />


## [The Five Contexts of Every Experience](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---2.-Contexts)
Every experience in the system is described through five independent “contexts.” Each context answers a different question:

#### Spatial Context — “Where does it happen?”
Defines the physical place or region. Definitions include geospatial datapoints.

#### Intent Context — “What is the user doing?” or "What does the user want to do?"
Defines the nature of the experience. This layer is experience‑agnostic, so new experience types can be added without restructuring the rest of the model.

#### Temporal Context — “When is it available?”
Defines schedules and availability. Temporal data changes frequently (seasonally, daily, even hourly), so isolating it keeps the system fast and maintainable.

#### Governance Context — “How is it managed?”
Defines rules, constraints, and operational behaviour. Governance can change independently of location, experience type, or schedule.

#### Identity Context — “Who is interacting with it?”
Defines users, roles, and permissions. Identity influences what people can see or do across all other contexts.

<img width="864" height="1289" alt="reservations_data_model-Contexts drawio" src="https://github.com/user-attachments/assets/14e4dd89-14f9-4df0-a0b6-c2f0b3033e02" />

## [How Data Is Stored](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---1.-Introduction#schema-categorization)
The model separates data into two major categories:

**Reference Data**
- Long‑lived, mostly static information (e.g., geozones, facilities, activities).
- Stored in a read‑optimized DynamoDB table.

**Transactional Data**
- Short‑lived, frequently updated information (e.g., bookings, user interactions).
- Stored in a write‑optimized DynamoDB table.

**DynamoDB** is the authoritative source of truth, using predictable partition keys for consistent access patterns. DynamoDB excels at structured queries - in other words, if you know what you're looking for, DynamoDB can get it for you cheaply and quickly. 

**OpenSearch** is used for:
- full‑text search
- geospatial search
- browsing and discovery

It stays synchronized with DynamoDB through DynamoDB streams. OpenSearch excels where DynamoDB is weak - unstructured, fuzzy searching - and therefore serves as a supplementary data management tool. 

In both public and administrative user stories, the system will drive users towards DynamoDB queries as their journey gets more and more specific, but OpenSearch remains to serve broader browsing and discovery use cases.  

## In Plain Terms

1. **This system sells experiences. Every experience is made of 5 ingredients: where, what, when, how, and who.**


2. **This model keeps these ingredients independent enough that they can be mixed and matched in any combination, without rewriting the system when something changes.**


3. **This strategic separation is what gives the system its flexibility.
If we start blending these ingredients together in the wrong places, we lose extensibility and recreate the old system’s problems.** 

The documented KPIs reflect the initial delivery slice (backcountry registrations), but the strategic intent expressed by leadership is to build a unified, extensible reservation platform. This data model was intentionally designed to satisfy both: it supports whichever reservations experience 'slice' must be addressed first, while providing a scalable foundation for all future offerings.

Read about the data model in more detail [on the wiki.](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model)



---

## Data-Model---1.-Overview---1.-Data-Storage,-Access,-and-Authority

# DynamoDB Partitioning

DynamoDB is the authoritative data store for most reference data in the PRDT system. All schemas use a **compound primary key** consisting of:

* **pk** - the partition key
* **sk** - the sort key

This structure groups related items together and ensures predictable, efficient queries. Combined, the `pk` and `sk` must be unique system-wide. 

To maintain consistency across all schemas, `pk`/`sk` values should aim to follow a shared naming convention.

## Partition Key (pk)

The partition key identifies a **logical grouping** of related items.

It should always begin with the **schema name** of the datatype the `pk` identifies.

Additional scoping properties should be appended when needed. For example, the `collectionId` is the backbone that groups experiences together logically. Appending `collectionId` will scope the partition to focus on items related by `collectionId`. 

```js
// Example pk for geozone for collection with collectionId bcparks_1
pk: geozone::bcparks_1                           
```

## Sort Key (sk)
The sort key uniquely identifies an item **within** a partition.

It should be concise, predictable, and structured to support efficient queries.

General sk rules:
* If the number of items in a partition is **unbounded**
   * If the **order** items are created in matters, or the `sk` is to remain **human-readable**, use an atomically incrementing **identifier**.
   * If the **order** does not matter and the `sk` does not need to remain **human-readable**, a UUID may suffice (less overhead on POST).
* If the number of items in a partition is projected to remain theoretically **finite**, use naturally unique properties to distinguish the item within a partition (e.g., productDates will have at most 1 item per day in each productDate partition, so use the short date to distinguish partition items),
* Some schemas may use a combination of approaches

```js
// Example pk/sk: productDate for 2025-12-31 for product #1 of dayuse activity #1 in collection bcparks_1 
pk: productDate::bcparks_1::dayuse::1
sk: 1::2025-12-31
```

## Global Identifiers and GSIs

Some schemas benefit from a **globalId** (UUID) that uniquely identifies an item across the entire system. 

This is useful when items must be referenced individually of a collection or other parent structure (e.g., bookings, user-generated content).

Leveraging a GSI on the `globalId` property can provide quick lookups for single items without having to know the item's data hierarchy or parent structure to craft its logical compound primary key. 

## OpenSearch Partitioning

OpenSearch is a distributed search and analytics engine that complements DynamoDB by supporting:

* full-text searching
* geospatial queries
* browsing and discovery search flows

It supplements DynamoDB where DynamoDB is weakest, namely in broad, unstructured search querying. DynamoDB remains the authoritative source, but it remains synchronized with OpenSearch indexes via **DynamoDB Streams**. 

### Large Geospatial Data

Some geospatial boundaries (e.g, polygons), exceed DynamoDB's item size limits. In these cases:

* The authoritative source becomes **AWS S3**
* The DynamoDB item stores a reference to the S3 source (URL)
* OpenSearch indexes the full geometry for spatial querying

### OpenSearch document IDs

Unlike DynamoDB, OpenSearch requires a single unique ID per document. To ensure reversibility and consistency, these IDs are constructed from the corresponding DynamoDB pk/sk:

```
<pk>#<sk>
```

This guarantees a one-to-one mapping between DynamoDB and OpenSearch. Since OpenSearch may index streamed data from multiple tables, the previous assertion of 
 
> Combined, the `pk` and `sk` must be unique system-wide. 

is a measure to prevent unintentional collisions across the various database services used in this project.

---

## Data-Model---1.-Overview---2.-Property-Types

Below is a table of property data types to enforce uniform data representation across all datapoints. 

|**Property Type**|**Description**|
|---|---|
|`String`|Primitive type|
|`Number`|Primitive type|
|`Boolean`|Primitive Type|
|`DateTime`|Full ISO timestamp, eg: `2025-01-01T00:00:00.000Z`|
|`Date`|Calendar date presented as an ISO-8601 Date (YYYY-MM-DD), eg: `2024-07-18`|
|`Time`|Time of day in 24h time, as ISO-8601 time (hh:mm:ss(:fff)), eg `15:30:00`|
|`Duration`|A non-specific, continuous span of time, presented as an ISO-8601 Duration, eg: `P14D` (14 days)|
|`DurationObj`|A non-specific, continuous span of time, presented as an object, eg: `{days: 14}` (14 days)|
|`Interval`|A specific, continuous span of time with a start and end, bound by ISO-8601 timestamps or a timestamp and a duration|
|`Array[propertyType]`|An array of `propertyType`|
|`Enum`|[Enumerator](#enums) - Special type that denotes a single value in a group of predefined/unchanging values|
|`GeoJSON`|[Valid geoJSON](https://geojson.org/). |
|`OSGeo`|[OpenSearch-coded](https://opensearch.org/docs/latest/field-types/supported-field-types/geographic/) geospatial data. OSGeo is used for OpenSearch indexing and may differ from raw GeoJSON in structure or supported geometry types|
|`Primary Key`|DynamoDB primary key represented as an object; composed of a partition key (pk) and sort key (sk), eg: `{pk: 'PK', sk: 'SK'}`|

* Review [luxon](https://moment.github.io/luxon/api-docs/index.html#duration) documentation regarding time-related property types.

## Date vs ISODate

* `Date` is used when the date needs to be decomposed into components.
* `ISODate` is used when a compact, sortable string representation is preferred.

## Duration vs Interval

* `Duration` is a continuous length of time with no fixed start or end
* `Interval` is a continuous length of time *anchored* by specific start and end `DateTimes`



---

## Data-Model---2.-Schemas---1.-Introduction

# Schema Categorization

The PRDT data model organizes all data into the following categories based on expected read/write intensity. This separation allows DynamoDB tables to be tuned for their specific workload patterns.

## Reference Data
Reference data consists of **long‑lived, persistent, and mostly static** information. It is read frequently and updated infrequently. Reference data is **read‑optimized** and stored in a DynamoDB table configured for high‑read throughput and predictable access patterns.

## Transactional Data
Transactional data consists of **short‑lived, dynamic, and frequently updated** information. It represents user actions or system events that change often. Transactional data is **write‑optimized** and stored in a DynamoDB table configured for high‑write throughput and rapid mutation.

## Relational Data (Future State)
[Relational Data](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---2.-Contexts#relationship-schemas) represents the connections between reference data items rather than the items themselves. These schemas capture two‑way, many‑to‑many relationships. Relational Data is intentionally lightweight and connection‑oriented. Each item expresses a single relationship and contains only the minimal information required to support efficient lookup in both directions. Its access patterns should be balanced: optimized enough to support fast traversal of the graph, but simple enough to remain flexible as the domain evolves.

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





---

## Data-Model---2.-Schemas---2.-Contexts

# The Contexts of the Data Model
This data model is intentionally structured around several distinct contexts that describe every offering. Separating schemas based on these contexts ensure the system remains flexable, scalable, and capable of supporting any current or future experience type.

Each context encapsulates different aspects about any offering:
- [Spatial context](#spatial-context): **Where** does it occur?
- [Intent context](#intent-context): **What** is the experience?
- [Temporal context](#temporal-context): **When** is it available?
- [Governance context](#governance-context): **How** is it governed, restricted, or made available to users?
- [Identity context](#identity-context): **Who** is interacting with it?

<img width="864" height="1289" alt="reservations_data_model-Contexts drawio" src="https://github.com/user-attachments/assets/a0d6dcad-5325-46f0-ab62-a8da7767a310" />

In the detailed descriptions below, note that some schemas fall in to more than one category. This is intentional as these types often provide logical bridges between contexts.

## Spatial Context

"Where does the experience occur?"

Spatial context describes the physical location or region associated with an experience.

Schemas that focus on spatial context include:
* Geozones
* Facilities
* Protected Areas (as a supplementary datatype)

Spatial data answers *where* an experience takes place, independent of what the experience is or when it occurs. Spatial boundaries change slowly, but experiences and schedules change frequently.

By isolating spatial data, the system avoids unnecessary duplication and can support:
- multi‑park experiences
- partial‑park experiences
- user‑defined regions
- future non‑park experiences

## Intent Context

"What is the user doing?/What is the user wanting to do?"

Intent context defines the nature of the offering itself.

Schemas that focus on experience context include:
* Activities
* Products
* ProductDates
* Inventory

The intent layer answers *what* the experience is, independent of when it is offered. In some cases, the spatial context overlaps, as *where* an experience occurs quite often goes hand in hand with exactly *what* the experience is. Intent definitions evolve over time. New activities or product types can be introduced without restructuring spatial or temporal data. This keeps the model experience‑agnostic and future‑proof.

## Temporal Context

"When is the experience offered?"

Temporal context describes the time‑based availability of an experience.

Schemas that focus on temporal context include:
* Products
* ProductDates
* Inventory

The temporal layer answers *when* an experience is available. Temporal data changes frequently - yearly, seasonally, daily, sometimes faster. By isolating temporal context, the system can:
- regenerate schedules without touching spatial or experience data
- support rolling availability
- handle seasonal changes cleanly
- scale to millions of date‑specific items

## Governance Context

"How is the experience made available?"

Governance context defines the rules, constraints, and behaviours that control how an experience is offered.

Schemas that focus on governance context include:
* Products
* ProductDates
* Inventory
* Policies

This layer answers *how* the system regulates access to the experience. Governance rules change independently of location, experience type, or schedule.
By isolating governance:
- capacity, pricing, and other operational rules can change on a daily cadence without changing other aspects of the experience
- multiple experiences can share the same operational rules

## Identity Context

"Who is interacting with the experience"

The identity context describes the users, administrators, and system actors who interact with PRDT. It includes authentication state, roles, and permissions that determine what data is visible, what actions are allowed, and how governance rules are applied. Closely linked to governance context, identity is a cross‑cutting context that influences behaviour across spatial, experience, and temporal layers.

Schemas that focus on identity context include:
* Bookings
* Users
* Transactions

# User Journey Phases

Public visitors and administrative users alike must be able to navigate the reservation system intuitively, without needing deep knowledge of the underlying data model. Across both groups, most user journeys follow three distinct phases of interaction.

- [Discovery](#discovery-phase)
- [Alignment](#alignment-phase)
- [Commitment](#commitment-phase)

Public visitors move through these phases as personal user journeys, while administrative users interact with these phases as functional domains.

<img alt="reservations_data_model-User Journey Phases drawio" src="https://github.com/user-attachments/assets/19a0c7c0-386a-4d2d-b3cb-78a526b7b08e" />

## Discovery Phase

The Discovery Phase is where users begin their journey, typically by arriving on a public‑facing or admin‑facing landing page. At this point, the system cannot assume any level of familiarity.

Users may have
- **Extensive system knowledge** "I know what I am looking for and I know how to find it."
- **No system knowledge** "I am not sure what I am looking for or how to start looking for it."
- **Anything in between** A partial understanding of the system and its capabilities.

Because of this wide range of familiarity, the system must introduce itself clearly to newcomers while still allowing experienced users to move quickly. The Discovery Phase is designed to support both: it exposes the breadth of what the system can do while enabling direct navigation for those who already know their path.

Schemas that support the Discovery Phase are 

- Geozones
- Facilities
- Activities

These schemas form a loosely hierarchical, many‑to‑many network that supports non‑linear exploration. They allow users to browse the system at a high level—by place or by activityType—before narrowing down to specific offerings. Together, they cover the **spatial** and **intent** context of the model.

### Ideal Discovery Flow

The data model is optimized to resolve user intent in the following order:

**where** -> **what** -> **when**

This order was chosen because:
- Users often begin with a place in mind, even if vague.
- Activities (intent) become meaningful only once anchored to a location.
- Temporal context (availability, pricing, policies) can only be resolved once the offering is known

### How the Data Model Currently Supports Discovery

With the help of [OpenSearch](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---1.-Overview---1.-Data-Storage,-Access,-and-Authority#opensearch-partitioning), the system currently supports full text searching. By using the `searchTerms` property on geozones, facilities, and activities, searching for a shared term among several datatypes will return them in a query. 

Example: If a user enters 'Bedwell', they should be returned a list of geozones, facilities and activities that relate to the Bedwell Lake Area in Strathcona Park

### How a Future Data Model State Might Bolster Discovery

#### Relationship Schemas

Geozones, facilities, and activities form a graph‑shaped network of two-way-linked, many‑to‑many relationships. Because DynamoDB does not support joins, and foreign keys become complicated to manage as the system scales, these relationships should be represented explicitly as relationship items.

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

This relationship schema provides a separation of duties, and keeps geozones, facilities, and activities truly within their respective spatial and intent contexts. A separate DynamoDB would be necessary to hold these relationship items. 

Questions that this future state can help answer:

- **"I know where I want to go**, but I dont know what's available or when" 
   - Navigate to a geozone or facility and see the activities associated with the location.
- **"I know what I want to do, and I have a vague idea of where I want to go**, but I don't know exactly where it's available or when"
   - Search by activity -> shows activityType and the geozones and facilities where it is offered.

#### Search by ActivityType

Activities include both an activityType (the generalized experience) and a location‑scoped identity that distinguishes where that experience occurs. For example, Backcountry Camping at Bedwell Lake and Backcountry Camping at Elk River share the same activityType but represent different activities.
Some visitors may begin their journey with a clear sense of what they want to do, but little or no preference for where it happens. Searching by activityType supports this intent, but because there are only a small number of activityTypes, a query at this level can return a very large set of results.

Questions this future state can help answer:

- **"I know what I want to do**, but I don't know when it's available, and I don't care where"
   - Without any spatial narrowing, a broad activityType (e.g., “backcountry camping”) may return hundreds of results across the province. Many of these results will not be meaningful to the user, who likely has implicit geographic constraints (travel distance, region, familiarity).

This query is still technically supportable, but the system should encourage users to provide at least a general sense of place to avoid overwhelming or irrelevant results.

#### Date-First Querying

None of the Discovery Phase schemas include **temporal** context. This makes the question:

- **"I know when I want to go**, but I don't know where or what I want to do"

...difficult to answer at this stage. Supporting this journey would require live availability indexing across the entire system - something only possible once the operational data model is fully stable. This makes it a strong candidate for future enhancement rather than a core Discovery Phase feature.

### Administration in the Discovery Phase

Administrative users may be responsible for crafting entities that support the Discovery Phase, such as managing activities, facilities, and geozones to support current BC Parks experiences and offerings.

## Alignment Phase

Once users understand *what* exists - the places, facilities and activities available in the system - they move into the **Alignment Phase**, where the system begins translating their interests into concrete, reservable offerings. This is the moment where intent meets operational reality.

In this phase, users shift from broad exploration to evaluating specific options. They are no longer asking "What can I do?" but rather:

- **"What does BC Parks offer that matches what I want?"**
- **"When is it available?"**
- **"What rules or constraints apply?"**

The Alignment Phase is where the system resolves these questions by mapping user intent to actual, date-specific offerings.

Schemas that support the Alignment Phase are:

- Products
- ProductDates
- Inventory

These schemas introduce the **temporal** and **governance** contexts absent in the Discovery Phase. Together, they form the bridge between high-level exploration and concrete booking options. Regardless of how users arrived from the Discovery Phase, the Alignment Phase answers:

- **"I see what they've got in relation to what I want"**

... and ensures the user is looking at **valid, operationally grounded choices**. 

Administrative users operate heavily in the Alignment Phase, acting as system stewards. They ensure that the offerings presented to the public are correct, operational, and aligned with policy and capacity business rules. 

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

Administrative users participate in the Commitment Phase in two distinct ways:

- As actors who can create, modify, and cancel commitments on behalf of others
   - Administrators interact with the Commitment Phase schemas with elevated authority and visibility, but the Commitment Phase ensures that administrative actions remain auditable, policy-compliant, and consistent with public actions so as to preserve the operational integrity of the system. 
- As stewards of the operational rules that govern commitments
   - Administrators don't just make commitments, they design the conditions under which commitments can occur. 

The Commitment Phase is the most operationally sensitive part of the user journey, where concurrency, policy enforcement, and financial correctness must all converge. Administrators must be able to intervene, correct, and support public users without bypassing the safeguards that prevent double-allocation, financial inconsistencies, or policy violations. 


 

---

## Data-Model---2.-Schemas---3.-Geozones

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
{
  "pk": "geozone::bcparks_1",
  "sk": "2",
  "schema": "geozone",
  "globalId": "345fg5e-4b7a-4c9f-9f22-1a4e8c9d77aa",
  "collectionId": "bcparks_1",
  "geozoneId": 2,
  "identifier": 2,
  "displayName": "Bedwell Trail Area",
  "description": "The Bedwell Lake Trail area in Strathcona Provincial Park is a steep but well‑built route leading to spectacular subalpine lakes surrounded by rugged mountain peaks, offering some of the park’s best day‑hiking and backcountry camping.",
  "envelope": {
    "type": "envelope",
    "coordinates": [
      [-125.610, 49.522],
      [-125.522, 49.482]
    ]
  },
  "boundaryUrl": "s3://...",
  "location": {
    "type": "point",
    "coordinates": [-125.589, 49.498]
  },

  "minMapZoom": 8,
  "maxMapZoom": 18,
  "imageUrls": [
    "https://...",
    "https://..."
  ],
  "timezone": "America/Vancouver",
  "isVisible": true,
  "creationDate": "2026-01-05T22:30:00.000Z",
  "lastUpdated": "2026-01-05T22:30:00.000Z",
  "version": 1,
  "searchTerms": "bedwell lake, baby bedwell lake, cream lake...",
  "adminNotes": "..."
}
```

<img alt="image" src="https://github.com/user-attachments/assets/3b20f5ee-337c-4581-be8d-22785df35b90" />
The envelope represented in this geozone.


## Strathcona Provincial Park

This example geozone shows how a park may be represented as a special kind of geozone. An additional field `orcs` pertaining to the ORCS ID, or some other field signifying this special geozone case, could be added if absolutely necessary. 

```json
{
  "pk": "geozone::bcparks_1",
  "sk": "1",
  "schema": "geozone",
  "globalId": "8f3c2d1e-4b7a-4c9f-9f22-1a4e8c9d77aa",
  "collectionId": "bcparks_1",
  "geozoneId": 1,
  "identifier": 1,
  "displayName": "Strathcona Provincial Park",
  "description": " BC's oldest park on Vancouver Island, offering camping, hiking, and other wilderness experiences.",
  "envelope": {
    "type": "envelope",
    "coordinates": [
      [-125.000, 49.000],
      [-125.000, 49.000]
    ]
  },
  "boundaryUrl": "s3://...",
  "location": {
    "type": "point",
    "coordinates": [-125.000, 49.000]
  },
  "minMapZoom": 6,
  "maxMapZoom": 16,
  "imageUrls": [
    "https://...",
    "https://..."
  ],
  "timezone": "America/Vancouver",
  "isVisible": true,
  "creationDate": "2026-01-05T22:30:00.000Z",
  "lastUpdated": "2026-01-05T22:30:00.000Z",
  "version": 1,
  "searchTerms": "buttle lake, strathcona, forbidden plateau, bedwell lake, elk river...",
  "adminNotes": "..."
}
```

# Protected Areas

Also known as 'parks', these datatypes were the backbone of older systems and are uniquely defined by the legally designated ORCS number assigned to each protected area. The concept of a 'park' or 'protected area' is shared by several areas of BC Parks so the definition used in this model is analogous to those pre-understood concepts. 

However, because the preexisting concept of a protected area is rooted in its legal definition, it is unable to change to accommodate the wide range of use cases this data model demands. This makes the protected area datatype a poor candidate for the backbone of this model.

[Collections](https://github.com/bcgov/reserve-rec-api/wiki/Data-Model---2.-Schemas---1.-Introduction#collections) remain the backbone of the data model, and [geozones](#geozones) remain the datatype at the very top of the data hierarchy. Protected areas can be represented as a subset of geozones and linked to collections as necessary to maintain continuity with historical systems or regulator requirements. See the [Strathcona Provincial Park](#strathcona-provincial-park) example of how this might be achieved. 






---

## Data-Model---2.-Schemas---4.-Facilities

# Facilities

A facility is a specific, physical feature represented by a geographic point, polyline, or polygon. Facilities describe real‑world infrastructure or natural features that visitors interact with directly. They are the most granular spatial element in the PRDT model. They typically include man-made structures such as: parking lots, campgrounds, trailheads, buildings, and viewpoints, but they may also represent natural features such as lakes, beaches or mountains when those features are meaningful to the user experience. 

A single facility may support zero, one, or many activities, and users may require permission to visit, stay at, or otherwise use certain facilities.

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
| `displayName`              | String              | Human‑readable name of the item. |
| `description`       | String              | Optional descriptive text explaining the purpose or operational meaning of the item. |
|`parentGeozones`|[Primary Key]|A list of geozone keys, used as a secondary grouping mechanism if the facility belongs to multiple geozones that either must be specified, or span collections| 
| `envelope`          | OSGeo   | Bounding box containing 2D spatial geometry, if it exists.  |
| `boundaryUrl`       | String  | Spatial footprint geometry, if it exists. Stored in S3 with a reference URL. |
|`location`|OSGeo|Geospatial point serving as the location of the facility, used for search relevance, sorting, clustering, and map pin placement|
|`path`|OSGeo| Spatial polyline geometry, if it exists. Usually will refer to a trail or road. May need to be stored as an S3 URL in the future|
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







---

## Data-Model---2.-Schemas---5.-Activities

# Activities

An activity represents a specific type of experience offered by BC Parks. Activities describe what a visitor can do at one or more physical locations (facilities). They form the core of the experience context in this data model.

Activities are defined by
- the type of experience (e.g., day‑use, camping, backcountry, boating), and
- the set of facilities where that experience is offered

If more than one activity of the same type is offered at the same set of facilities, they are disambiguated using an atomically incrementing identifier (e.g., 1, 2, 3).

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

## Collections and User‑Defined Activities
Activities are grouped using collectionIds, just like facilities and geozones.
This ensures that all experience types within a collection can be queried together.
Collection IDs:
- are not a datatype
- do not have their own schema
- are simple labels used to group related reference‑data items
User‑defined activities may also exist in the future, and would be stored in their own collections (e.g., activity::user_<userId>).

# Properties
Note: The activity configuration file is the authoritative source for the current schema.


---

## Data-Model---2.-Schemas---6.-Products-and-ProductDates

# Products and ProductDates

A product is a specific, governed instance of an activity. Where an activity defines what a visitor can do, a product defines how that experience is generally offered - including its time windows, rules, and operational behaviour. If an activity is the 'experience', the product is the 'offering'.

Products are coupled closely with productDates, which resolve how an experience is offered on a specific calendar day. Products act as the *definition* of the offering. ProductDates act as the *execution* of that offering. Although productDates carry the fully resolved governance rules (booking windows, fees, restrictions, reservable times, etc.), Products remain a critical layer of the model. They provide the structure, identity, and administrative control needed to generate and manage productDates at scale.

For each product, at most one productDate can exist for every date that the system must manage. On dates where no productDate exists, the system is unable to allocate products to users. 

## ProductDates as System Governance Modules

ProductDates are where the system performs the real work of governance. For each date that a product is to be managed in the system, a productDate captures specifically how that management will occur.

Each ProductDate contains:
- one calendar date (and applicable timezone!)
- a fully resolved reservation window
- the resolved change/party rules
- the resolved fee schedule
- the capacity used to generate Inventory
- any other governing rules denormalized to apply to the specific date in question

Because ProductDates are immutable, read‑optimized, and self‑contained, the system can answer operational questions like:
- “Is this reservable on this date?”
- “What rules apply on this date?”
- “How many units remain?”

ProductDates are the authoritative, day‑specific representation of the offering.

## Products as Administrative Management Modules

Even though productDates carry the operational logic, products remain essential for both administrative and public‑facing contexts.

### Public Context

Products define the identity of the offering (public context) and give users meaningful choices such as:
- “Cheakamus - Trail Day Use – Morning Pass”
- “Cheakamus - Trail Day Use – Afternoon Pass”

Products also provide stable grouping for search and discovery. Users search for offerings, not dates.
Products allow the system to answer questions like:
- “What day‑use options exist at Cheakamus?”
- “What backcountry camping experiences are available in Cape Scott?”

Products group productDates into meaningful offerings that users can understand. Without products, the system would have to expose hundreds of individual productDates with no grouping or identity. Products allow the public interface to show offerings, not raw dates.

### Administrative Context

Products also define the template used to generate productDates (administrative context). Administrators can use products to
- set default policies
- define the date range for the season
- define the time windows (AM/PM, nightly, hourly)
- define the metadata and naming
- regenerate productDates for new seasons
- apply rule changes to future dates

## Why the System Needs Both
- ProductDates are the operational backbone of the system. They contain the fully resolved rules, policies, and temporal logic that govern each day.
- Products are the structural and semantic backbone of the system. They define the offering, group ProductDates, support search, and enable administrators to manage rules and seasons efficiently.

Together, they form a clean separation between:
- what the offering is (Product)
- when it exists and how it behaves (ProductDate)

This separation keeps the model scalable, maintainable, and intuitive for both users and administrators.

# Properties

See config.


---

## Data-Model---2.-Schemas---7.-Inventory-and-Assets

# Inventory

Inventory represents the most granular, indivisible unit of an offering.

It is the smallest piece of availability that can be claimed by exactly one user at a time. Once an inventory unit is claimed, it cannot be claimed by anyone else for the same date.

Inventory always corresponds to:
- a specific offering (what the user gets), and
- a specific date (when the user gets it).

This makes inventory the foundation of the reservation system’s concurrency model.

### Basic Example of Inventory
A single tentpad for a single night is one inventory item:
- Tentpad #43 at Rathtrevor Beach on 2024‑08‑15

If a user claims this inventory item:
- no other user can claim Tentpad #43 on that date
- Tentpad #43 may still be available on other dates
- other tentpads may still be available on the same date

Each date and each asset represents a distinct inventory unit.

### Multiple Asset Example of Inventory
If a user books Tentpad #43 for three nights:
- 2024‑08‑15
- 2024‑08‑16
- 2024‑08‑17
They have claimed 3 inventory items (one per night), even though it is a single booking.

If a user books three different tentpads on the same night:
- Tentpad #43
- Tentpad #44
- Tentpad #45
They have also claimed 3 inventory items, but these represent different assets on the same date.

## Types of Inventory

Inventory comes in two forms: *fixed* and *flex*.

The distinction determines how the system allocates inventory across multi-day stays.

### Fixed Inventory

Fixed inventory refers to inventory tied to a specific [physical asset](#assets) that must remain consistent across all dates of a user's stay.

Examples:
- a specific campsite
- a specific cabin
- a specific parking stall (if assigned parking)

For fixed inventory:
- the system must allocate the *same asset* for the entire duration of the booking.
- availability must be checked across all dates for that specific asset
- even if a campground has availability on all dates, the booking fails if *no single asset* is available for the entire stay

This matches user expectations: campers do not want to switch campsites mid-stay.

### Flex inventory

Flex inventory refers to inventory that is not tied to a specific asset. The system only needs to ensure that *any asset* (capacity) exists on each date of the user's stay.

#### Trail Day Use Example
* a trail has a capacity limit (e.g., 200 people per day).
* users claim capacity units, not specific assets.
* if a user wants to visit for three days, the system only needs to check that capacity exists on each day.

A unit of capacity still counts as an [asset](#asset), but a flexible, non-physical asset that is governed by less-stringent allocation rules than fixed assets.

#### Backcountry Reservations Example
A counterintuitive, but important case:
* Backcountry reservations allocate tentpads for campers, but importantly, do NOT assign specific tentpads to specific campers.
* Users are guaranteed *a* tentpad, but not a specific one.
* The daily capacity of a backcountry reservation offering equals the number of reservable tentpad assets at that location.
* Users can stay multiple nights without being assigned to the same tentpad each night YET will not have to switch tentpads mid stay. 

If the system manages capacity the same way trail capacity is managed, then the system only needs to check that capacity exists on each date of stay. If a camper makes a reservation for three nights and the system determines there is capacity on all dates, the camper can pick ANY empty tentpad on their date of arrival and will not have to move for the duration of their stay. 

## Seeding Inventory

Inventory is the most granular unit of an offering, and therefore provides the clearest, most accurate representation of its *availability*. Any availability check, whether for a single date or an entire season, ultimately depends on the state of the underlying inventory. But before the system can report availability, the inventory must already exist. This raises an important question: when and how does inventory come into existence?

Products and ProductDates, configured by system administrators, define the operational scaffolding from which inventory is generated. Administrators determine how far into the future they want the system to support bookings, configure the product accordingly, and then run a generation script that seeds inventory for that window.

Ideally, this generation occurs well before the public begins browsing or reserving. Without pre‑seeded inventory, the system has nothing to allocate, and users may encounter gaps or degraded functionality.

However, generating too far into the future introduces its own risks. The farther ahead inventory is created, the more likely it is that operational details will change, requiring reconfiguration and reseeding. This can be complex and costly, especially if the product is already active and has existing bookings.

Products should also define sensible default behaviours for cases where the system cannot locate related inventory, ensuring predictable and user‑friendly outcomes.

## Present vs Available

Inventory has two distinct qualities: **presence** and **availability**.
- **Presence** means the inventory exists in the system. Pre‑seeding brings inventory into existence and makes it “present.”
- **Availability** means the inventory can be claimed by a user.

These concepts are related but not interchangeable:
- Inventory can only be available if it is also present.
- Inventory can be present but unavailable, such as when:
   - The parent park or product is closed
   - All capacity is already claimed
   - The reservation window is not open (too early or too late)
   - A temporary hold prevents immediate allocation
- When inventory is both present and available, a user may claim it.

This distinction allows the system to differentiate between “this inventory exists but cannot be booked” and “this inventory does not exist at all.”

## Infinite Inventory
Some operational scenarios involve effectively infinite capacity. For example, certain backcountry registration products, such as Cape Scott, do not enforce a hard capacity limit.

To support these cases without breaking the standard presence/availability model, the system seeds a **single inventory item per ProductDate**. When users make bookings, their records reference this inventory item, but the item itself never transitions to an unavailable state. No write operation consumes or locks the inventory.

This approach ensures that infinite‑capacity products behave consistently with finite ones, while maintaining fast reads and avoiding unnecessary concurrency logic.

## Summary
Inventory is the atomic unit of availability in the system.
It ensures that:
- fixed assets remain consistent across multi‑day stays
- flex assets can be allocated dynamically
- concurrency is handled safely and efficiently
- ProductDates can be fulfilled without hot‑item contention

Inventory is where the system enforces the rule:

> “Only one user can claim this unit of availability on this date.”

# Assets

Assets represent persistent, non-temporal physical or conceptual objects that can eventually become [inventory](#inventory) when paired with a product/productDate. They are the "things" BC Parks manages that exist independently of time.

An asset
* always exists
* does not change based on time (daily, seasonally, annually, etc)
* is NOT reservable on its own
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







---

## Data-Model---2.-Schemas---8.-Policies

# Policies

Policies define the rules that govern how reservations behave across the entire system.

They describe:
- when users can make reservations
- how users can modify or cancel existing reservations
- who can participate in the experience they are reserving
- what they will be charged for the experience

Policies are reusable, versioned rulesets that allow BC Parks to manage complex governance without duplicating logic across thousands of products and productDates.

Although each policy type focuses on a different aspect of reservation behaviour, they all share a common structure and lifecycle:
- They are reusable - a single policy can apply to many products.
- They are versioned - once they are referenced to make bookings, they are immutable to that booking
- They are resolved into productDates - all policy logic is denormalized into each productDate for fast, predictable evaluation.
- They support granular behaviour - products can specify alternate policies for specific dates or seasons.

Policies allow the system to express governance rules in a consistent, maintainable way. Without policies, each product would need to embed its own governance rules, leading to duplication, drift, and inconsistent behaviour. By centralizing policy rules into policy objects:
- BC Parks can update rules in one place.
- Products remain lightweight and focused on describing the offering.
- ProductDates can be generated with fully resolved, immutable governance rules, and regenerated easily if necessary.
- Bookings retain the exact rules that applied at the time of purchase. 

Policies are the backbone of the system's governance model.

## Shared Policy Concepts
Every policy has:
- a policy type (booking, change, party, fee)
- a policyId (the logical identifier)
- a policyIdVersion (the version number)
- a displayName and description
- metadata such as creation and update timestamps

This ensures policies are easy to reference, audit, and evolve.

Policies are never edited in place. Instead:
- A new version is created when rules change.
- Products can preconfigured to always use the latest policy version, or lock in a specific version.
- Existing bookings retain the old version.

This protects users from retroactive rule changes and provides a clear audit trail.

All policy types share a common evaluation pattern:
- Policies are evaluated relative to arrivalDate and departureDate.
- Time‑based rules anchor to local park time, not UTC.
- Booking windows, change windows, and fee calculations are deterministic.
- Overrides are applied before denormalization, ensuring ProductDates are immutable.

This makes runtime evaluation simple and predictable.

## Policy Primitives
Policy primitives are the fundamental building blocks used to define all reservation governance in the system. While the system exposes high-level [policy types](#policy-types), each of these types is ultimately composed from a shared set of primitives. These primitives provide consistent vocabulary for expressing rules, ensure predictable, deterministic behaviour across products, and make the policy layer extensible as new reservation models are introduced.

Understanding these primitives is essential for understanding how policies work, how overrides behave, and how ProductDates are generated.

All policies are composed from these seven primitives:
- [Temporal Window Primitive](#temporal-window-primitive) — define when an action is allowed
- [Temporal Anchor Primitive](#temporal-anchor-primitive) — define what point in time rules are relative to
- [Temporal Duration Primitive](#temporal-duration-primitive) — define how long something must or may last
- [Interval Primitive](#interval-primitive) — define groups of dates that behave as a unit
- [Eligibility Primitive](#eligibility-primitive) — define who or what qualifies
- [Financial Primitive](#financial-primitive) — define what fees apply and when
- [Action Primitive](#action-primitive) — define which operations are permitted

Each primitive is small and self‑contained, but together they can express the full complexity of reservation governance.

## Temporal Anchor Primitive

The date or time that temporal calculations are relative to.

Examples:
- Arrival Date (00:00 local time)
- Departure Date (00:00 local time)
- Reservation Date
- Fixed calendar datetimes (e.g., “Jan 17 at 08:00 local time”)

Anchor rules ensure that booking windows, change windows, and fee calculations behave consistently—even across daylight savings transitions.

Schema:
```js
TemporalAnchor: {
   anchor: TemporalAnchorEnum;   // ENUM of available temporal anchors
   offset?: string;              // optional - time-of-day offset (00:00 is default)
   timezone?: string;            // optional - IANA timezone identifier (America/Vancouver is default)
   fixedDate?: string;           // optional - calendar date if anchor = fixedDate
}
```
Property|Type|Required|Description  
-- | -- | -- | --
anchor | TemporalAnchorEnum |Yes| The reference point used for time calculations. Determines how windows and durations are interpreted  
offset | string |   | Time-of-day offset applied to the anchor. Defaults to 00:00 if omitted
timezone | string |   | America/Vancouver
fixedDate | string |   | anchor = "fixedDate"

TemporalAnchorEnum: {
   "arrivalDate",
   "departureDate",
   "reservationDate",
   "fixedDate"
}


Example: 
```json
"temporalAnchor": {
   "anchor": "arrivalDate"
   "offset": "00:00",
   "timezone": "America/Vancouver"
}
```

## Temporal Duration Primitive

The length of time of an event.

Examples:
- Minimum/maximum stay length
- Length of a rolling reservation window (4 months in advance, two days in advance)
- Minimum notice before arrival
- Penalty windows (“changes within 48 hours incur a fee”)

Duration rules allow the system to express constraints that depend on how long something lasts, not just when it occurs.

Schema
```js
TemporalDuration {
  // At least one field must be present.
  years?: number;    // integer ≥ 0
  months?: number;   // integer ≥ 0
  weeks?: number;    // integer ≥ 0
  days?: number;     // integer ≥ 0
  hours?: number;    // integer ≥ 0
  minutes?: number;  // integer ≥ 0
  seconds?: number;  // integer ≥ 0
}
```
- All fields are optional, but at least one must be provided.
- All values must be non‑negative integers.
- Durations are not normalized (e.g., { months: 4 } stays as 4 months).

Example:
```json
"temporalDuration": {
  "months": 4
}
```
## Temporal Window Primitive

When an action is allowed or disallowed. They are comprised of a temporal duration primitive, a temporal anchor primitive, and optionally, a local time zone.

Examples:
- When reservations open and close
- When changes/cancellations are permitted
- When peak pricing or discounts apply

Window rules give the system deterministic control over time‑bounded actions. They are always evaluated relative to a temporal anchor (e.g., arrival date at 00:00, a fixed calendar date, or a local wall‑clock time).

```js
TemporalWindow {
  anchor: TemporalAnchor;     // required — reference point for both boundaries
  open?: WindowBoundary;      // optional — if omitted, window has no opening constraint
  close?: WindowBoundary;     // optional — if omitted, window has no closing constraint
}

WindowBoundary {
  offset?: TemporalDuration;      // optional — how far before/after the anchor
  direction?: "before" | "after"; // required if offset is present
  timeOfDay?: LocalTime;          // optional — overrides anchor.offset for this boundary
}
```

Example: 
```json
"temporalWindow": {
  "anchor": {
    "anchor": "arrivalDate",
    "offset": { "hour": 00, "minute": 00 },
    "timezone": "America/Vancouver"
  },
  "open": {
    "offset": { "months": 4 },
    "direction": "before",
    "timeOfDay": { "hour": 7, "minute": 0 }
  },
  "close": {
    "direction": "after",
    "offset": { "days": 0 },
    "timeOfDay": { "hour": 23, "minute": 59 }
  }
}

```

### Interval Primitive

Groups of dates that behave as a unit.

Examples:
- Holiday weekend minimum‑stay requirements
- Blackout periods where changes are not allowed
- Peak season pricing intervals
- Discount intervals

Intervals allow the system to express rules like “if you book any date in this block, special rules apply.”

Schema:
```js
Interval {
  dates: LocalDate[];          // required — list of ISO dates (YYYY-MM-DD)
  requireAllDates?: boolean;   // optional — default false
  blockActions?: boolean;      // optional — default false
}
```
Example: Special event pricing applies only if the entire stay covers July 1–3.
```json
"interval": {
  "dates": [
    "2025-07-01",
    "2025-07-02",
    "2025-07-03"
  ],
  "requireAllDates": true,
  "blockActions": false
}
```

### Eligibility Primitive

Whether a user, booking, or inventory item qualifies for an action.

Examples:
- Age requirements for the named occupant
- Party size limits
- Vehicle limits
- Discount eligibility (senior, youth, program‑based)

Eligibility rules are intentionally flexible. They ensure that actions are only allowed when the user or booking meets specific criteria.

```js
Eligibility {
  criteria: EligibilityCriterion[];   // required — list of rules evaluated as AND by default
  any?: boolean;                      // optional — if true, criteria are OR instead of AND
}

EligibilityCriterion {
  field: string;                      // required — attribute being evaluated (e.g., "partySize", "user.age")
  operator: EligibilityOperator;      // required — comparison operator
  value: any;                         // required — comparison value (number, string, boolean, enum)
}

EligibilityOperator:
  "eq" | "neq" | "lt" | "lte" | "gt" | "gte" |
  "in" | "notIn" | "exists" | "notExists"
```

Example: Min named occupant age is 16 AND max party size is 4 people.
```json
"eligibility": {
  "criteria": [
    { "field": "namedOccupant.age", "operator": "gte", "value": 16 },
    { "field": "partySize", "operator": "lte", "value": 4 }
  ],
  "any": false
}
```

### Financial Primitive

What fees apply and under what conditions.

Examples:
- Nightly camping fees
- Reservation fees
- Change/cancellation fees
- Penalties for late changes
- Discounts and fee modifiers

Financial rules determine the monetary impact of user actions and must be deterministic and versioned for auditability.

```js
FinancialRule {
  type: FinancialRuleType;            // required — fee, discount, penalty, modifier
  amount: Money;                      // required — fixed amount or percentage
  appliesTo: FinancialTarget;         // required — what the rule applies to
  conditions?: Eligibility;           // optional — eligibility conditions for this rule
  intervals?: Interval[];             // optional — date blocks where rule applies
}

FinancialRuleType:
  "fee" | "discount" | "penalty" | "modifier"

Money {
  currency: string;                   // e.g., "CAD"
  value: number;                      // numeric amount
  isPercentage?: boolean;             // optional — if true, value is treated as %
}

FinancialTarget:
  "reservation" | "nightly" | "perPerson" | "perVehicle" | "perAsset"
```

Example: Backcountry registrations are $10/adult, $5/youth.

```json
"backcountryRegistrationAdultFee" : {
  "type": "fee",
  "amount": {
    "currency": "CAD",
    "value": 10,
  },
  "appliesTo": "perAdult",
  "conditions": {
    "numberOfAdults": [
      {
        "field": "party.adultCount",
        "operator": "gt",
        "value": 0
      } 
    ]
  },
}

"backcountryRegistrationYouthFee" : {
  "type": "fee",
  "amount": {
    "currency": "CAD",
    "value": 5,
  },
  "appliesTo": "perYouth",
  "conditions": {
    "numberOfYouths": [
      {
        "field": "party.perYouth",
        "operator": "gt",
        "value": 0
      } 
    ]
  },
}
```

### Action Primitive

Which actions are allowed, restricted, or prohibited.

- Whether bookings are allowed.
- Whether changes or cancellations are allowed.
- Whether multi‑unit bookings are allowed.

Action rules define the operational boundaries of each policy type.

## How Primitives Compose into Policy Schemas

Policy primitives are the foundational building blocks of the reservation governance model. Each primitive represents a small, focused concept—such as a time window, a duration constraint, or an eligibility requirement. Policy types (Booking, Change, Party, Fee) are not independent inventions; they are compositions of these primitives arranged to express the rules relevant to each domain.

## Policy Types
The system defines four core policy types:
- [Booking Policy](#booking-policies) — when users can book and how stays are structured
- [Change Policy](#change-policies) — how reservations can be modified or cancelled
- [Party Policy](#party-policies) — who can participate and how groups are structured
- [Fee Policy](#fee-policies) — what users pay and how charges are calculated

Each type has its own schema and composition of primitives, described in the following sections.

# Booking Policies

Booking policies govern how inventory becomes available and how users claim it.

They are composed from:
- Window Primitives — when reservations open and close
- Anchor Primitives — typically the arrival date at 00:00 local time
- Duration Primitives — minimum/maximum stay length
- Interval Primitives — holiday weekends or special‑event blocks
- Action Primitives — whether booking is allowed
- Operational Times — check‑in, check‑out, no‑show timing

# Change Policies

Change policies govern how reservations can be modified or cancelled.

They are composed from:
- Window Primitives — when changes/cancellations are allowed
- Anchor Primitives — usually arrival or departure date
- Duration Primitives — notice periods, penalty thresholds
- Interval Primitives — blackout periods
- Eligibility Primitives — which bookings or users qualify
- Financial Primitives — change fees, penalties, forfeitures
- Action Primitives — whether changes/cancellations are allowed

# Party Policies

Party policies govern who can participate in a reservation.

They are composed from:
- Eligibility Primitives — age, party size, vehicles, group composition
- Action Primitives — whether multi‑unit bookings are allowed

# Fee Policies

Fee policies govern what users pay and when fees apply.

They are composed from:
- Financial Primitives — nightly fees, reservation fees, discounts
- Interval Primitives — peak season pricing, discount periods
- Anchor Primitives — typically arrival date for nightly fees



---

## Data-Model---2.-Schemas---9.-Bookings-&-Transactions

# Bookings

A booking represents a user's claim on inventory. It describes the nature of the claim, links inventory with the user who claimed it, and additionally links the transaction that completed the booking with (if it exists).

## Bookings and Inventory states

Bookings ensure that both visitors and administrators have a clear, authoritative record of who holds a piece of inventory, when they hold it, and under which rules the transaction was completed. Because inventory represents finite, claimable capacity, each unit can be allocated to at most one user at any moment in time. Throughout its lifecycle—whether available, held in a cart, purchased, cancelled, returned, expired, or in any other state—an individual inventory unit can occupy only a single state at once, ensuring unambiguous ownership and preventing double‑allocation.

Inventory only cares about whether it is available or not, and behaves accordingly. Bookings add a descriptive layer for when inventory becomes unavailable through a claim made by a user. This layer controls the flow of inventory during these states of unavailability.

|Booking State of Inventory|Inventory Availability|Inventory Claimed|Description|
|---|---|---|---|
|*no state*|✅|❌|Inventory is available (no claim)|
|held|❌|✅|Inventory is temporarily claimed by user (in user's cart) but booking has not been completed|
|reserved|❌|✅|Inventory has been purchased by the user through a transaction|
|cancelled|✅|❌|Inventory was part of a completed booking, but the user made a change that released the inventory back into the availability pool|
|expired|❌|✅|The inventory is part of a completed booking for which the date has now passed|



---

