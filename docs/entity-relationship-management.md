# Entity Relationship Management

## Overview

The PRDT system implements an entity relationship management system that enables bidirectional connections between different entity types (geozones, facilities, activities, and products). The system is designed for efficient querying, data integrity, and automatic cascade operations.

## Table of Contents

1. [Data Model](#data-model)
2. [Entity Hierarchy](#entity-hierarchy)
3. [Core Functions](#core-functions)
4. [Entity Creation Workflow](#entity-creation-workflow)
5. [Querying Relationships](#querying-relationships)
6. [Deleting Relationships](#deleting-relationships)
7. [API Endpoints](#api-endpoints)
8. [Examples](#examples)


## Data Model

### Relationship Item Structure

Relationships are stored as separate items in the DynamoDB Reference Data table with the following structure:

```js
{
  // Primary keys for forward lookup
  pk: "rel::activity::bcparks_250::dayUse::1",
  sk: "facility::bcparks_250::parking::5",
  
  // GSI keys for reverse lookup
  gsipk: "rel::facility::bcparks_250::parking::5",
  gsisk: "activity::bcparks_250::dayUse::1",
  
  // Metadata
  schema: "relationship",
  schema1: "activity",
  schema2: "facility",
  
  // Original entity keys
  pk1: "activity::bcparks_250",
  sk1: "dayUse::1",
  pk2: "facility::bcparks_250",
  sk2: "parking::5"
}
```

### Key Components

| Field | Description |
|-------|-------------|
| `pk` | Relationship primary key: `rel::{schema1}::{compoundPk1}::{sk1}` |
| `sk` | Target entity: `{schema2}::{compoundPk2}::{sk2}` |
| `gsipk` | GSI primary key (inverse of pk): `rel::{schema2}::{compoundPk2}::{sk2}` |
| `gsisk` | GSI sort key (inverse of sk): `{schema1}::{compoundPk1}::{sk1}` |
| `schema1` | Source entity schema type |
| `schema2` | Target entity schema type |
| `pk1/sk1` | Full keys of source entity |
| `pk2/sk2` | Full keys of target entity |

## Entity Hierarchy

The system maintains a strict hierarchy to ensure relationships are always stored in the same direction:

```
┌─────────────┐
│  Geozone    │  Level 0 (Highest)
│  (e.g., PNR)│
└──────┬──────┘
       │
┌──────▼──────┐
│  Facility   │  Level 1
│  (Parking)  │
└──────┬──────┘
       │
┌──────▼──────┐
│  Activity   │  Level 2
│  (Day Use)  │
└──────┬──────┘
       │
┌──────▼──────┐
│  Product    │  Level 3 (Lowest )
│  (Ticket)   │
└─────────────┘
```

### Allowed Relationships

| Source Entity | Can Link To |
|---------------|-------------|
| Geozone | Facility, Activity |
| Facility | Activity, Geozone |
| Activity | Geozone, Facility |
| Product | Activity (implicit via pk structure) |

**Note:** Products are intrinsically linked to activities through their primary key structure (`product::bcparks_250::backcountryCamp::1::3::base`), so explicit product-activity relationships are not needed.

---

## Core Functions

### 1. Helper function `shouldSwapSchemas(schema1, schema2)`

Determines if two schemas should be swapped to maintain hierarchy order.

```js
function shouldSwapSchemas(schema1, schema2) {
  const hierarchy = { geozone: 0, facility: 1, activity: 2, product: 3 };
  const level1 = hierarchy[schema1];
  const level2 = hierarchy[schema2];
  return level1 !== undefined && level2 !== undefined && level1 > level2;
}
```

**Usage:**

Passing in `schema1` activity and `schema2` geozone:

```js
shouldSwapSchemas('activity', 'geozone')  // true (swap needed)
```

Compared to `schema1` geozone and `schema2` facility:

```js
shouldSwapSchemas('geozone', 'facility')  // false (already correct order)
```

---

### 2. `createRelationshipItem(schema1, pk1, sk1, schema2, pk2, sk2)`

Creates a single relationship item ready for DynamoDB insertion.

**Parameters:**
- `schema1`: First entity schema (e.g., 'activity')
- `pk1/sk1`: First entity keys
- `schema2`: Second entity schema (e.g., 'facility')
- `pk2/sk2`: Second entity keys

**Returns:** Marshalled DynamoDB item

**Example:**

Creating a single relationship between an activity and a facility.

```js
// Activity
{
  'pk': 'activity::bcparks_250',
  'sk': 'dayUse::1'
}

// Facility
{
  'pk': 'facility::bcparks_250',
  'sk': 'parking::5'
}
```

Is passed into the `createRelationshipItem` like so:


```js
const relationshipItem = createRelationshipItem(
  'activity',
  'activity::bcparks_250',
  'dayUse::1',
  'facility',
  'facility::bcparks_250',
  'parking::5'
);
```
---

### 3. `batchWriteRelationships(relationshipItems, tableName)`

Batch writes relationship items to DynamoDB.

**Parameters:**
- `relationshipItems`: Array of PutRequest items
- `tableName`: DynamoDB table name

**Behavior:**
- Writes in batches of 25 (DynamoDB limit)
- Handles retry logic automatically via `batchWriteData`

---

### 4. `createEntityWithRelationships(config)`

Complete workflow for creating entities with relationships and retry logic. This consolidates the common pattern used across other entity POST handlers.

**Config Object:**
```js
{
  schema: 'product',              // Entity schema
  collectionId: 'bcparks_250',     // Collection ID
  body: { ...requestBody },        // Request body with entity data
  relationshipFields: ['activities'],  // Fields to extract
  putConfig: PRODUCT_API_PUT_CONFIG,  // Validation config
  parseRequest: parseRequest,      // Entity-specific function
  tableName: REFERENCE_DATA_TABLE_NAME,  // Optional
  maxRetries: 3                    // Optional, default 3
}
```

**Returns:**
```js
{
  success: true,
  postRequests: [...],             // Created entity requests
  relationshipCount: 2,            // Number of relationships created
  attempts: 1                      // Attempts taken
}
```

**Workflow:**
1. Parse request body to get entity items
2. Extract relationships from each entity
3. Clean entity data (remove relationship fields)
4. Create entity via `batchTransactData`
5. Create relationships via `batchWriteRelationships`

**Example Usage:**
```js
const result = await createEntityWithRelationships({
  schema: 'product',
  collectionId: 'bcparks_250',
  body: req.body,
  relationshipFields: ['activities'],
  putConfig: ACTIVITY_API_PUT_CONFIG,
  parseRequest: parseRequest // Product-specific parseRequest
});
```

---

### 5. `deleteEntityRelationships(schema, pk, sk, tableName)`

Deletes all relationships associated with an entity (cascade delete).

**Parameters:**
- `schema`: Entity schema type
- `pk/sk`: Entity keys
- `tableName`: Optional, defaults to `REFERENCE_DATA_TABLE_NAME`

**Returns:**
```js
{
  deletedCount: 5,              // Total relationships deleted
  forwardRelationships: 3,      // Where entity was source
  reverseRelationships: 2       // Where entity was target
}
```

**Process:**
1. Constructs relationship pk: `rel::{schema}::{compoundPk}::{sk}`
2. Queries main table for forward relationships
3. Queries GSI (`entityRelationship-index`) for reverse relationships
4. Deletes all found relationships in batches of 100

**Example:**
```js
const result = await deleteEntityRelationships(
  'activity',
  'activity::bcparks_250',
  'dayUse::1'
);
// Returns: { deletedCount: 3, forwardRelationships: 2, reverseRelationships: 1 }
```

**GSI Fallback:**
If the GSI doesn't exist, the function continues with forward relationships only.

---

## Querying Relationships

### Forward Lookup (Source -> Targets)

Query relationships where a specific entity is the source.

**Example: Get all facilities linked to an activity**

```js
const pk = 'rel::activity::bcparks_250::dayUse::1';

const query = {
  TableName: REFERENCE_DATA_TABLE_NAME,
  KeyConditionExpression: 'pk = :pk',
  ExpressionAttributeValues: {
    ':pk': { S: pk }
  }
};

const results = await runQuery(query);
// Returns all relationships where the activity is the source
```

**Results:**
```js
[
  {
    pk: "rel::activity::bcparks_250::dayUse::1",
    sk: "facility::bcparks_250::parking::5",
    pk2: "facility::bcparks_250",
    sk2: "parking::5"
  }
]
```

---

### Reverse Lookup (Target <- Sources)

Query relationships where a specific entity is the target using the GSI.

**Example: Get all activities linked to a facility**

```js
const gsipk = 'rel::facility::bcparks_250::parking::5';

const query = {
  TableName: REFERENCE_DATA_TABLE_NAME,
  IndexName: 'entityRelationship-index',
  KeyConditionExpression: 'gsipk = :gsipk',
  ExpressionAttributeValues: {
    ':gsipk': { S: gsipk }
  }
};

const results = await runQuery(query);
// Returns all relationships where the facility is the target
```

**Results:**
```js
[
  {
    pk: "rel::activity::bcparks_250::dayUse::1",
    sk: "facility::bcparks_250::parking::5",
    gsipk: "rel::facility::bcparks_250::parking::5",
    gsisk: "activity::bcparks_250::dayUse::1",
    pk1: "activity::bcparks_250",
    sk1: "dayUse::1"
  }
]
```

---

### Bidirectional Query

To get all relationships for an entity (both directions):

```js
async function getAllRelationships(schema, pk, sk) {
  const compoundPk = pk.replace(`${schema}::`, '');
  const relationshipPk = `rel::${schema}::${compoundPk}::${sk}`;

  // Forward relationships (entity as source)
  const forwardQuery = {
    TableName: REFERENCE_DATA_TABLE_NAME,
    KeyConditionExpression: 'pk = :pk',
    ExpressionAttributeValues: {
      ':pk': { S: relationshipPk }
    }
  };
  const forwardResults = await runQuery(forwardQuery);

  // Reverse relationships (entity as target)
  const reverseQuery = {
    TableName: REFERENCE_DATA_TABLE_NAME,
    IndexName: 'entityRelationship-index',
    KeyConditionExpression: 'gsipk = :gsipk',
    ExpressionAttributeValues: {
      ':gsipk': { S: relationshipPk }
    }
  };
  const reverseResults = await runQuery(reverseQuery);

  return {
    forward: forwardResults.items,
    reverse: reverseResults.items,
    total: forwardResults.items.length + reverseResults.items.length
  };
}
```

---

### Expanding Entity Data

To include full entity objects in relationship results:

**API Handler Pattern:**
```js
const relationships = await runQuery(query);

// Expand entities using batch get
const entityKeys = relationships.items.map(rel => ({
  pk: rel.pk2,
  sk: rel.sk2
}));

const entities = await batchGetData(entityKeys);

// Combine relationship metadata with entity data
const expandedResults = relationships.items.map(rel => ({
  ...rel,
  entity: entities.find(e => e.pk === rel.pk2 && e.sk === rel.sk2)
}));
```

---

## Deleting Relationships

### Individual Relationship Deletion

Delete a specific relationship between two entities:

```js
const deleteRelationship = async (schema1, pk1, sk1, schema2, pk2, sk2) => {
  // Apply schema swapping if needed
  if (shouldSwapSchemas(schema1, schema2)) {
    [schema1, schema2] = [schema2, schema1];
    [pk1, sk1, pk2, sk2] = [pk2, sk2, pk1, sk1];
  }

  const compoundPk1 = pk1.replace(`${schema1}::`, '');
  const compoundPk2 = pk2.replace(`${schema2}::`, '');

  const deleteItem = {
    TableName: REFERENCE_DATA_TABLE_NAME,
    Key: marshall({
      pk: `rel::${schema1}::${compoundPk1}::${sk1}`,
      sk: `${schema2}::${compoundPk2}::${sk2}`
    })
  };

  await dynamoDb.deleteItem(deleteItem).promise();
};
```

---

### Cascade Entity Deletion

When deleting entities, relationships must be deleted first:

**Example: Activity DELETE Handler**
```js
exports.handler = async (event, context) => {
  try {
    const collectionId = event.pathParameters.collectionId;
    const activityType = event.queryStringParameters.activityType;
    const activityId = event.queryStringParameters.activityId;

    if (event.body) {
      throw new Exception("Body is not allowed", { code: 400 });
    }

    // Step 1: Delete all relationships
    const pk = `activity::${collectionId}`;
    const sk = `${activityType}::${activityId}`;
    
    const relationshipResult = await deleteEntityRelationships(
      'activity', 
      pk, 
      sk
    );
    
    logger.info(`Deleted ${relationshipResult.deletedCount} relationships`);

    // Step 2: Delete the entity itself
    const deleteItem = {
      action: 'Delete',
      data: {
        TableName: REFERENCE_DATA_TABLE_NAME,
        Key: marshall({ pk, sk }),
        ConditionExpression: 'attribute_exists(pk) AND attribute_exists(sk)'
      }
    };

    await batchTransactData([deleteItem]);

    return sendResponse(200, {
      success: true,
      relationshipsDeleted: relationshipResult.deletedCount
    }, 'Success', null, context);

  } catch (error) {
    return sendResponse(
      error.code || 400,
      null,
      error.message || 'Error deleting activity',
      null,
      context
    );
  }
};
```

**Why This Order?**
- Relationships reference entity keys
- Deleting entity first would leave orphaned relationships
- Cascade approach ensures referential integrity

---

## API Endpoints

### Relationship Management Endpoints

#### **GET /relationships**
Query relationships with filters.

**Query Parameters:**
- `sourceSchema`: Filter by source entity type
- `sourcePk`: Filter by source pk
- `sourceSk`: Filter by source SK
- `targetSchema`: Filter by target entity type
- `expand`: Include full entity objects (default: false)

**Response:**
```json
{
  "items": [
    {
      "pk": "rel::activity::bcparks_250::dayUse::1",
      "sk": "facility::bcparks_250::parking::5",
      "schema1": "activity",
      "schema2": "facility",
      "entity": {
        "displayName": "Main Parking Lot",
        "facilityType": "parking"
      }
    }
  ],
  "count": 1
}
```

---

#### **POST /relationships**
Create a new relationship between entities.

**Request Body:**
```json
{
  "sourceSchema": "activity",
  "sourcePk": "activity::bcparks_250",
  "sourceSk": "dayUse::1",
  "targetSchema": "facility",
  "targetPk": "facility::bcparks_250",
  "targetSk": "parking::5"
}
```

**Response:**
```json
{
  "success": true,
  "relationship": {
    "pk": "rel::activity::bcparks_250::dayUse::1",
    "sk": "facility::bcparks_250::parking::5"
  }
}
```

---

#### **DELETE /relationships**
Delete a specific relationship.

**Request Body:**
```json
{
  "sourceSchema": "activity",
  "sourcePk": "activity::bcparks_250",
  "sourceSk": "dayUse::1",
  "targetSchema": "facility",
  "targetPk": "facility::bcparks_250",
  "targetSk": "parking::5"
}
```

**Response:**
```json
{
  "success": true,
  "deleted": 1
}
```

---

## Examples

### Example 1: Creating a Facility with Multiple Relationships

**Request:**
```json
POST /facilities/bcparks_250?facilityType=parking

{
  "displayName": "North Parking Area",
  "facilityType": "parking",
  "capacity": 50,
  "activities": [
    { "pk": "activity::bcparks_250", "sk": "dayUse::1" },
    { "pk": "activity::bcparks_250", "sk": "camping::2" }
  ],
  "geozones": [
    { "pk": "geozone::bcparks_250", "sk": "3" }
  ]
}
```

**What Gets Created:**

1. **Facility Entity:**
```js
{
  pk: "facility::bcparks_250",
  sk: "parking::15",
  displayName: "North Parking Area",
  facilityType: "parking",
  capacity: 50
  // activities and geozones fields removed
}
```

2. **Relationships (after schema swapping):**
```js
// Activity -> Facility (swapped from Facility -> Activity)
{
  pk: "rel::activity::bcparks_250::dayUse::1",
  sk: "facility::bcparks_250::parking::15",
  gsipk: "rel::facility::bcparks_250::parking::15",
  gsisk: "activity::bcparks_250::dayUse::1"
}

// Activity -> Facility
{
  pk: "rel::activity::bcparks_250::camping::2",
  sk: "facility::bcparks_250::parking::15",
  gsipk: "rel::facility::bcparks_250::parking::15",
  gsisk: "activity::bcparks_250::camping::2"
}

// Geozone -> Facility (swapped from Facility -> Geozone)
{
  pk: "rel::geozone::bcparks_250::3",
  sk: "facility::bcparks_250::parking::15",
  gsipk: "rel::facility::bcparks_250::parking::15",
  gsisk: "geozone::bcparks_250::3"
}
```

---

### Example 2: Querying All Facilities for a Geozone

**Goal:** Find all facilities in geozone 3 of bcparks_250

**Query:**
```js
const gsipk = 'rel::geozone::bcparks_250::3';

const query = {
  TableName: REFERENCE_DATA_TABLE_NAME,
  IndexName: 'entityRelationship-index',
  KeyConditionExpression: 'gsipk = :gsipk AND begins_with(gsisk, :facility)',
  ExpressionAttributeValues: {
    ':gsipk': { S: gsipk },
    ':facility': { S: 'facility::' }
  }
};

const results = await runQuery(query);
```

**Results:**
```js
[
  {
    pk: "rel::geozone::bcparks_250::3",
    sk: "facility::bcparks_250::parking::15",
    gsipk: "rel::geozone::bcparks_250::3",
    gsisk: "facility::bcparks_250::parking::15",
    pk2: "facility::bcparks_250",
    sk2: "parking::15"
  },
  {
    pk: "rel::geozone::bcparks_250::3",
    sk: "facility::bcparks_250::campground::8",
    pk2: "facility::bcparks_250",
    sk2: "campground::8"
  }
]
```

---

### Example 3: Cascade Deleting an Activity

**Scenario:** Delete activity `dayUse::1` from `bcparks_250`

**Step 1: Query Relationships**
```js
const pk = 'activity::bcparks_250';
const sk = 'dayUse::1';

const relResult = await deleteEntityRelationships('activity', pk, sk);
// Returns: { deletedCount: 4, forwardRelationships: 2, reverseRelationships: 2 }
```

**Step 2: Delete Entity**
```js
const deleteItem = {
  action: 'Delete',
  data: {
    TableName: REFERENCE_DATA_TABLE_NAME,
    Key: marshall({ pk, sk })
  }
};

await batchTransactData([deleteItem]);
```

**Result:**
- 4 relationships deleted
- 1 activity entity deleted
- Related facilities and geozones remain intact

---

## Best Practices

### 1. Always Use Schema Swapping
```js
// ✓ Correct
if (shouldSwapSchemas(schema1, schema2)) {
  [schema1, schema2] = [schema2, schema1];
  [pk1, sk1, pk2, sk2] = [pk2, sk2, pk1, sk1];
}

// ✗ Incorrect (direct creation without checking)
createRelationshipItem(schema1, pk1, sk1, schema2, pk2, sk2);
```

### 2. Use Local Variables in Loops
```js
// ✓ Correct
for (const entity of entities) {
  let schema1 = sourceSchema;  // Local copy
  let schema2 = targetSchema;  // Local copy
  // ... swap logic
}

// ✗ Incorrect (mutates loop variables)
for (const entity of entities) {
  if (shouldSwap) {
    [sourceSchema, targetSchema] = [targetSchema, sourceSchema];  // Affects next iteration!
  }
}
```

### 3. Always Delete Relationships Before Entities
```js
// ✓ Correct order
await deleteEntityRelationships(schema, pk, sk);
await deleteEntity(pk, sk);

// ✗ Incorrect (orphans relationships)
await deleteEntity(pk, sk);
await deleteEntityRelationships(schema, pk, sk);  // Won't find anything!
```

### 4. Validate Entity Existence Before Creating Relationships
```js
// Ensure both entities exist before linking
const sourceEntity = await getOne(sourcePk, sourceSk);
const targetEntity = await getOne(targetPk, targetSk);

if (!sourceEntity || !targetEntity) {
  throw new Exception('One or both entities do not exist', { code: 404 });
}

await createRelationship(...);
```

### 5. Use Batch Operations for Performance
```js
// ✓ Correct (batch)
await batchWriteRelationships(relationshipItems, tableName);

// ✗ Inefficient (individual writes)
for (const item of relationshipItems) {
  await dynamoDb.putItem(item).promise();
}
```

---

## Troubleshooting

### Issue: Duplicate Relationships

**Symptom:** Same relationship exists in both directions

**Cause:** Schema swapping not applied consistently

**Solution:**
- Ensure `shouldSwapSchemas()` is called before every relationship creation
- Use `createRelationshipItem()` helper function
- Never manually construct relationship keys

---

### Issue: Orphaned Relationships

**Symptom:** Relationships exist but entities are deleted

**Cause:** Entity deleted before relationships

**Solution:**
- Always call `deleteEntityRelationships()` first
- Use cascade delete pattern in all entity DELETE handlers

---

### Issue: GSI Query Errors

**Symptom:** `ResourceNotFoundException` when querying reverse relationships

**Cause:** GSI `entityRelationship-index` doesn't exist

**Solution:**
- Wrap GSI queries in try-catch
- Fall back to forward relationships only
- Ensure GSI is deployed in CDK stack

---

### Issue: Relationship Not Found

**Symptom:** Query returns empty but relationship should exist

**Cause:** Incorrect compound key construction

**Solution:**
- Verify schema prefix removal: `activity::bcparks_250` -> `bcparks_250`
- Check relationship pk format: `rel::{schema}::{compound}::{sk}`
- Ensure schema swapping was applied during creation

---

## Performance Considerations

### Query Patterns
- **Single entity relationships**: 1 query (forward or reverse)
- **Bidirectional lookup**: 2 queries (main table + GSI)
- **Batch entity fetch**: Use `batchGetData()` after relationship query

### Write Performance
- Relationships written in batches of 25
- Entity creation + relationships typically < 100ms
- Retry logic handles transient failures

### Delete Performance
- Cascade deletes process relationships in batches of 100
- Typical delete: 50-200ms depending on relationship count

---

## Future Enhancements

1. **Relationship Metadata**: Add timestamps, created by, relationship type
2. **Relationship Attributes**: Support custom attributes on relationships (e.g., role, priority)
3. **Many-to-Many Validation**: Prevent duplicate relationships
4. **Soft Deletes**: Mark relationships as inactive instead of deleting
5. **Relationship History**: Track changes to relationships over time
6. **Circular Reference Detection**: Prevent relationship loops
7. **Batch Relationship Updates**: Update multiple relationships atomically

---

## Conclusion

The entity relationship system provides a robust, scalable solution for managing connections between entities in the Reserve & Recreation platform. By following the hierarchy rules, using the provided utility functions, and adhering to best practices, developers can efficiently create, query, and manage entity relationships while maintaining data integrity.

For questions or issues, refer to the troubleshooting section or consult the development team.
