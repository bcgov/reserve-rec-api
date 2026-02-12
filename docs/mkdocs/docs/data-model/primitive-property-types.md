Below is a table of property data types to enforce uniform data representation across all datapoints.

|**Property Type**|**Description**|
|---|---|
|`String`|Primitive type|
|`Number`|Primitive type|
|`Boolean`|Primitive Type|
|`TimeStamp`|Full ISO timestamp, eg: `2025-01-01T00:00:00.000Z`|
|`Date`|Calendar date presented as an ISO-8601 Date (YYYY-MM-DD), eg: `2024-07-18`|
|`Time`|Time of day in 24h time, as ISO-8601 time (hh:mm:ss(:fff)), eg `15:30:00`|
|`Duration`|A non-specific, continuous span of time, presented as an object, eg: `{days: 14}` (14 days)|
|`Array[propertyType]`|An array of `propertyType`|
|`Enum`| Enumerator - Special type that denotes a single value in a group of predefined/unchanging values|
|`GeoJSON`|[Valid geoJSON](https://geojson.org/). |
|`OSGeo`|[OpenSearch-coded](https://opensearch.org/docs/latest/field-types/supported-field-types/geographic/) geospatial data. OSGeo is used for OpenSearch indexing and may differ from raw GeoJSON in structure or supported geometry types|
|`Primary Key`|DynamoDB primary key represented as an object; composed of a partition key (pk) and sort key (sk), eg: `{pk: 'PK', sk: 'SK'}`|

* Review [luxon](https://moment.github.io/luxon/api-docs/index.html#duration) documentation regarding time-related property types.

