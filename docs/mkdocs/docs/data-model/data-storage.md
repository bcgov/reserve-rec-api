# DynamoDB Partitioning

DynamoDB is the authoritative data store for most reference data in the PRDT system. All schemas use a **compound primary key** consisting of:

* **pk** - the partition key
* **sk** - the sort key

This structure groups related items together and ensures predictable, efficient queries. Combined, the `pk` and `sk` must be unique system-wide.

To maintain consistency across all schemas, `pk`/`sk` values should aim to follow a shared naming convention.

## Partition Key (pk)

The partition key identifies a **logical grouping** of related items.

It should always begin with the **schema name** of the datatype the `pk` identifies.

It should aim to be **human-guessable** and **predictable** to support debugging and manual queries.

Additional scoping properties should be appended when needed. For example, the `collectionId` is the backbone that groups experiences together logically. Appending `collectionId` will scope the partition to focus on items related by `collectionId`.

```js
// Example pk for geozone for collection with collectionId bcparks_1
pk: geozone::bcparks_1
```

## Sort Key (sk)
The sort key uniquely identifies an item **within** a partition.

It should be concise, predictable, and structured to support efficient queries.

It should aim to be **human-guessable** and **predictable** to support debugging and manual queries.

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