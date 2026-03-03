# Change Policy

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`pk`|String|Partition key| "policy::\<policyType>::\<policyId>"|Searching all versions of this policy|
|`sk`|String|Sort key| "v\<policyIdVersion>" OR "latest" |Searching for a specific version of this policy|
|`gsipk`|String|Global secondary index partition key| Reserved | Reserved |
|`gsisk`|String|Global secondary index sort key| Reserved | Reserved |
| `schema`|String|Data type/Schema| "policy" |Identifying that this item is a "policy"|
|`globalId`|String|Globally unique UUID|Automatically generating on policy creation|Searching for this specific item using the `globalId` GSI|
|`policyType`|String|The type of policy| "party" |Searching for all policies of this type|
|`policyId`|String|A unique identifier for this policy, specific to the policy type|Automatically generating on policy creation|Searching for all versions of this specific policy|
|`policyIdVersion`|Number|The version number of this policy|Automatically incrementing on policy update|Searching for a specific version of this policy|
|`isLatest`|Boolean|Whether this is the latest version of the policy|Automatically setting on policy update|Searching for the latest version of this policy|
|`displayName`|String|A human-readable name for this policy|Provided on policy creation and update|Displaying this policy in a user interface|
|`description`|String|A human-readable description of this policy|Provided on policy creation and update|Displaying this policy in a user interface|
|`productRules`|[ChangeProductRules](#changeproductrules)|The rules that govern how this policy is applied at the Product level|Provided on policy creation and update|Evaluating whether a Product complies with the rules defined in this policy|
|`productDateRules`|[ChangeProductDateRules](#changeproductdaterules)|The rules that govern how this policy is applied at the Product-Date level|Provided on policy creation and update|Evaluating whether a Product-Date complies with the rules defined in this policy|
|`createdAt`|Timestamp|The timestamp when this policy was created|Automatically setting on policy creation|Tracking when this policy was created|
|`lastUpdated`|Timestamp|The timestamp when this policy was last updated|Automatically updating on policy update|Tracking when this policy was last updated|

## ChangeProductRules
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isChangeAllowed`|Boolean|Whether changes are allowed for this Product|Provided on policy creation and update|Evaluating whether changes are allowed for a Product|
|`isCancellationAllowed`|Boolean|Whether cancellations are allowed for this Product|Provided on policy creation and update|Evaluating whether cancellations are allowed for a Product|

## ChangeProductDateRules
|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`isChangeAllowed`|Boolean|Whether changes are allowed for this ProductDate|Provided on policy creation and update|Evaluating whether changes are allowed for a ProductDate|
|`isCancellationAllowed`|Boolean|Whether cancellations are allowed for this ProductDate|Provided on policy creation and update|Evaluating whether cancellations are allowed for a ProductDate|