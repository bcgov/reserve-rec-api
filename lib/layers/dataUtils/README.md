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
The list of items to update. Each item should be of the form: 
```json
{
	key: {
		pk: <partition-key>,
		sk: <sort-key>
	},
	data: { 
		<updateData>
		field1: {
			value: <newValue>,
			action: <updateAction>
		},
		field2: {
			value: <newValue>,
			action: <updateAction>
		},
		field3: {},
		...
	},
	config?: <updateConfiguration> 
}
```
Where `key` is the DynamoDB primary key of the item to update.

The `data` property contains the individual fields to update, and the new values that they should assume after updating. The `data` property can either be constructed as an object of key-value pairs:
```json
data: {
	field1: newValue,
	field2: newValue,
	field3: newValue,
	...
}
```
or as a compound datatype where the update action can be specified. The available update actions are [`set`, `add`, `append`, `remove`]. If only key-value pairs are supplied, the `set` action will be assumed:
* `set`: change the field to the new value. If the field does not exist, it will be initialized with the new value.
* `add`: mathematically add the new value to the existing field value. Only applicable to number datatypes. If the new value is negative, the new value will be subtracted from the existing value. If the field does not exist, it will be initialized with 0 before applying the math operation.
* `append`: Concatenate the new value to the end of the existing value, provided both the new and existing values are arrays. If the field does not exist, it will be initialized with the new value.
* `remove`: Delete the field from the object. If the field does not exist, no action will be taken.
```json
data: {
	stringField: {
		value: 'newValue',
		action: 'set'
	},
	objectField: {
		value: {
			newObjProp1: 'value',
			newObjProp2: {
				subObjProp: 'value'
				}
			},
		action: 'set'
	}
	addNumberField: {
		value: 3,
		action: 'add'
	},
	subtractNumberField: {
		value: -1,
		action: 'add'
	},
	appendField: {
		value: [
			'value'
		],
		action: 'append'
	},
	removeField: {
		action: 'remove'
	}
}
```

#### `config` \<Object>
A configuration object for the update to be performed. The `config` object enables finer control over the conditions that must be met before a field updates.
```javascript
// Api update configuration example
const CONFIG = {
	autoTimestamp: true,
	autoVersion: true,
	failOnError: true,
	fields: {
		field1: '<fieldRules>',
		field2: '<fieldRules>',
		field3: '<fieldRules>',
		...
	}
}
```
##### `autoTimestamp` \<Boolean>
If set to `true`, the property `lastUpdated` will be updated with an ISO timestamp of the current time (UTC) using the `set` action.

##### `autoVersion` \<Boolean>
If set to `true`,  the property `version` will be atomically increased by 1 using the `add` action.

##### `failOnError`\<Boolean>
If set to `true`, all updates in `updateList` will fail if a single error is encountered. If set to `false`, the item in `updateList` that caused the error will be skipped and the operation will continue.

##### `fields` \<Object>
An object that contains the fine-grain validation rules for a particular field. Each key in `fields` corresponds to a key (field name) in the `item.data` property.

The value of each key is a group of field rules that will be used to validate incoming requests. If an incoming request has a field in `item.data` that does not exist in the config's `fields` property, validation will fail (updating that field is not permitted). Therefore, the `fields` property acts as a whitelist that allows control over which fields can be updated. 

The following rules can be applied to each field in `fields`
|property|explanation|
|---|---|
|`isMandatory`| A boolean value. If set to `true`, then the field must be present in the request, or the request will fail.|
|`rulesFn`|A function that will run on the field. The field's proposed `value` and `action` will be provided to the function. Within the function, these properties can be validated. Throw an error within the function if there is an invalidity.|
#### Example

Given the following DynamoDB Table 'TABLE' with a single document: 
```json
// TableName: 'TABLE'
{
	"pk": {"S": "primaryKey"},
	"sk": {"S": "sortKey"},
	"badField": {"S": "bad Value"},
	"setField" {"S": "old Value"}
}
```
```javascript

// Config object
const CONFIG = {
	autoTimestamp: true,
	autoVersion: true,
	failOnError: true
	fields: {
		stringField: {
			isMandatory: true,
			rulesFn(): ({value, action}) => {
				if (typeof value !== 'string') {
					throw new Error('String expected.');
					}
				}
			}
		},
		setField: {
			rulesFn(): ({value, action}) => {
				if (action !== 'set') {
					throw new Error(`${action} is not allowed on this field.`);
				}
			}
		}
	}
}

// updateList object
let updateList = [
	{
		key: {
			pk: 'primaryKey',
			sk: 'sortKey',
		},
		data: <dataItem>
	}
]

await quickApiUpdateHandler('TABLE', updateList, CONFIG);
```
|`dataItem` structure|result|
|---|---|
|<pre><code>{<br>&nbsp;&nbsp;newField: "new Value"<br>}</code></pre>|ERROR: Field `newField` is not allowed to be updated.|
|<pre><code>{<br>&nbsp;&nbsp;setField: "new Value"<br>}</code></pre>|ERROR: Field `stringField` is a mandatory field that is missing in the request, as set by `CONFIG`|
|<pre><code>{<br>&nbsp;&nbsp;stringField: "new Value"<br>}</code></pre>|SUCCESS.<pre><code>{<br>&nbsp;&nbsp;"pk": {"S":"primaryKey"},<br>&nbsp;&nbsp;"sk": {"S":"sortKey"},<br>&nbsp;&nbsp;"badField": {"S":"bad Value"},<br>&nbsp;&nbsp;"setField": {"S":"old Value"},<br>&nbsp;&nbsp;"stringField": {"S":"new Value"}<br>}</code></pre>|
|<pre><code>{<br>&nbsp;&nbsp;setField: "new Value"<br>&nbsp;&nbsp;stringField: "new Value"<br>}</code></pre>|SUCCESS.<pre><code>{<br>&nbsp;&nbsp;"pk": {"S":"primaryKey"},<br>&nbsp;&nbsp;"sk": {"S":"sortKey"},<br>&nbsp;&nbsp;"badField": {"S":"bad Value"},<br>&nbsp;&nbsp;"setField": {"S":"new Value"},<br>&nbsp;&nbsp;"stringField": {"S":"new Value"}<br>}</code></pre>|
|<pre><code>{<br>&nbsp;&nbsp;setField: {<br>&nbsp;&nbsp;&nbsp;&nbsp;value: "new Value",<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "set"<br>&nbsp;&nbsp;}<br>&nbsp;&nbsp;stringField: "new Value"<br>}</code></pre>|SUCCESS.<pre><code>{<br>&nbsp;&nbsp;"pk": {"S":"primaryKey"},<br>&nbsp;&nbsp;"sk": {"S":"sortKey"},<br>&nbsp;&nbsp;"badField": {"S":"bad Value"},<br>&nbsp;&nbsp;"setField": {"S":"new Value"},<br>&nbsp;&nbsp;"stringField": {"S":"new Value"}<br>}</code></pre>|
|<pre><code>{<br>&nbsp;&nbsp;setField: {<br>&nbsp;&nbsp;&nbsp;&nbsp;value: "new Value",<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "append"<br>&nbsp;&nbsp;}<br>&nbsp;&nbsp;stringField: "new Value"<br>}</code></pre>|ERROR: `append` action is not allowed on field `setField`, as set by `rulesFn` in `CONFIG`.|
|<pre><code>{<br>&nbsp;&nbsp;setField: {<br>&nbsp;&nbsp;&nbsp;&nbsp;value: "new Value",<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "set"<br>&nbsp;&nbsp;}<br>&nbsp;&nbsp;stringField: { <br>&nbsp;&nbsp;&nbsp;&nbsp;value: 123,<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "set",<br>}</code></pre>|ERROR: Field `stringField` expected `string` type update value, but got `number`. Set by `rulesFn` in `CONFIG`.|
|<pre><code>{<br>&nbsp;&nbsp;setField: {<br>&nbsp;&nbsp;&nbsp;&nbsp;value: "new Value",<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "set"<br>&nbsp;&nbsp;}<br>&nbsp;&nbsp;stringField: { <br>&nbsp;&nbsp;&nbsp;&nbsp;value: "new Value",<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "set",<br>}</code></pre>|SUCCESS.<pre><code>{<br>&nbsp;&nbsp;"pk": {"S":"primaryKey"},<br>&nbsp;&nbsp;"sk": {"S":"sortKey"},<br>&nbsp;&nbsp;"badField": {"S":"bad Value"},<br>&nbsp;&nbsp;"setField": {"S":"new Value"},<br>&nbsp;&nbsp;"stringField": {"S":"new Value"}<br>}</code></pre>|
|<pre><code>{<br>&nbsp;&nbsp;badField: {<br>&nbsp;&nbsp;&nbsp;&nbsp;action: "remove"<br>&nbsp;&nbsp;}<br>}</code></pre>|SUCCESS.<pre><code>{<br>&nbsp;&nbsp;"pk": {"S":"primaryKey"},<br>&nbsp;&nbsp;"sk": {"S":"sortKey"},<br>&nbsp;&nbsp;"setField": {"S":"new Value"},<br>&nbsp;&nbsp;"stringField": {"S":"new Value"}<br>}</code></pre>|
