## InventoryPool


|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`pk`|String|Partition key |"inventory::\<collectionId>::\<activityType>::\<activityId>::\<productId>::\<date>"|Identifying all InventoryPools for a specific Product on a specific date|
|`sk`|String|Sort key|"asset::\<collectionId>::\<facilityType>::\<facilityId>::\<assetType>::\<assetId>::\<inventoryId>"|Identifying the specific InventoryPool, which is the specific Asset that will be managed by the Pool|
|`gsipk`|String|Global secondary index partition key|Reserved|Reserved|
|`gsisk`|String|Global secondary index sort key|Reserved|Reserved|
| `schema`|String|Data type/Schema| "inventoryPool" |Identifying that this item is an "InventoryPool"|
| `globalId`| String|Globally unique UUID|Automatically generating on Inventory seed| Searching for this specific item using the `globalId` GSI|
|`assetRef`|PrimaryKey|Reference to the Asset that is being managed by this InventoryPool|Derived from the `sk`|Identifying the specific Asset that is being managed by this InventoryPool|
|`date`|Date|The calendar date for which this InventoryPool manages Inventory|Referenced ProductDate|Identifying which date this InventoryPool is associated with|
|`productDateRef`|PrimaryKey|Reference to the ProductDate that this Inventory unit is available for reservation|Referenced ProductDate|Identifying which ProductDate this Inventory unit is associated with|
|`productDateVersion`|String|The version of the ProductDate at the time this Inventory unit was seeded|Referenced ProductDate|Ensuring consistency between the Inventory unit and the ProductDate it is associated with|
|`capacity`|Number|The maximum capacity of Inventory that can be reserved in this InventoryPool|Seeded value|Indicating the maximum amount of Inventory that can be reserved in this Pool|
|`availability`|Number|The quantity of Inventory available in this InventoryPool|Seeded value|Indicating how much Inventory is currently available for reservation in this Pool|
|`createdAt`|Timestamp|The timestamp when this Inventory unit was created|Automatically generating on Inventory seed|Tracking when this Inventory unit was created|