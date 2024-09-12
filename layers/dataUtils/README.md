# Quick Api Helper Functions
  ## `quickApiUpdateHandler`
This function provides a generic way to perform AWS DynamoDB `UpdateItem` actions on one or many objects at the same time. It can be used to simplify `PUT` endpoints for datatypes, provided the update flow is reasonably simple. Instead of writing lengthy, unique custom code for each datatype, `quickApiUpdateHandler` can perform single or bulk update actions with minimal configuration.

**Use**:
```javascript
await quickApiUpdateHandler(tableName, updateList, config)
```
#### `tableName` \<String>:
The name of the target DynamoDB table.

#### `updateList` \<Array>:
The list of items to update. Each item should contain a `key` property and at least one of the action properties [`set`, `add`, `append`, `remove`]:

```javascript
const updateList = [
	{
		key: {
			pk: `<partition-key>`,
			sk: `<sort-key>`
		},
		set: {
			stringField: 'new-value',
			numberField: 1,
			booleanField: true,
			mapField: { key: 'value' },
			listField: [1, 2, 3]
		},
		add: {
			atomicIncrementer: 1,
			atomicDecrementer: -1
		},
		append: {
			stringList: ['new-value'],
			mapList: [
				{nestedProp: 'new-value'}
			]
		},
		remove: [
			'removeThisProp',
			'andRemoveThisProp'
		]
	}
]
```
##### `key` \<Object>
 The `key` should contain the primary key of the item receiving the update (in `pk`/`sk` format).

##### `set` \<Object>
The `set` property is for updating fields or adding new ones. The properties in `set` should be an object where the keys are the fields to update and the values are the new values. The fields in the updated object will be overwritten by the values. If no field exists, it will be initialized with the provided value.

##### `add` \<Object>
The `add` property is for mathematically adding a number to a field. The properties in `add` should be an object where the keys are the fields to update and the values are the numbers to add. To subtract a number, use a negative value. If the field does not exist, it will be initialized with the value provided added to 0.

##### `append` \<Object>
The `append` property is for appending an item to a list. The property values in `append` must be a list. If the field does not exist, it will be initialized with the value provided as a list.

##### `remove` \<Array>
The `remove` property is for removing fields from an item. The properties in `remove` should be a list of fields to remove. If the field does not exist, the action will succeed but nothing will happen.

#### `config` \<Object>
A configuration object for the update to be performed. The `config` object enables finer control over the conditions that must be met before a field updates.
```javascript
// Api update configuration example
const CONFIG = {
	actionRules = {
		set: '<actionRuleSet>',
		add: '<actionRuleSet>',
		append: '<actionRuleSet>',
		remove: '<actionRuleSet>'
	}
	autoTimestamp: true,
	autoVersion: true,
	failOnError: true,
}
interface actionRuleSet = {
	blacklist?: ['blacklistedField1', 'blacklistedField2'],
	whitelist?: ['blacklistedField1', 'blacklistedField2'],
	mandatoryFields?: ['mandatoryField1', 'mandatoryField2'],
	allowAll?: true
}
```
##### `actionRules` \<Object>
An object with properties [`set`, `add`, `append`, `remove`] corresponding to the actions that area allowed in `updateItems`. Each action property is an action rule set that controls the update behaviour on fields affected by that action. If an action is not listed in `actionRules`, the default behaviour is to deny updates to any field that request that type of update action.

##### `blacklist` \<Array>
 The `blacklist` property is an array of fields that the updater is forbidden to make changes to. An error will be thrown if the action performed includes updating at least one field in `blacklist`.

##### `whitelist` \<Array>
Similarly, the `whitelist` property is an array of fields that the updater is permitted to make changes to, but any change to a field not listed in `whitelist` will throw an error.

##### `mandatoryFields` \<Array>
The updater will throw an error if any field in the `mandatoryFields` object is not provided.

##### `allowAll` \<Boolean>
Set `allowAll = true` to permit the action on any field. Note: to deny the action on every field, omit the action property entirely from `actionRules`.

##### `autoTimestamp` \<Boolean>
If set to `true`, the property `lastUpdated` will be updated with an ISO timestamp of the current time (UTC) using the `set` action.

##### `autoVersion` \<Boolean>
If set to `true`,  the property `version` will be atomically increased by 1 using the `add` action.

##### `failOnError`\<Boolean>
If set to `true`, all updates in `updateList` will fail if a single error is encountered. If set to `false`, the item in `updateList` that caused the error will be skipped and the operation will continue.