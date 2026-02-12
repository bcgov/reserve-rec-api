# Fee Policy

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
|`productRules`|[FeeProductRules](#feeproductrules)|The rules that govern how this policy is applied at the Product level|Provided on policy creation and update|Evaluating whether a Product complies with the rules defined in this policy|
|`productDateRules`|[FeeProductDateRules](#feeproductdaterules)|The rules that govern how this policy is applied at the ProductDate level|Provided on policy creation and update|Evaluating whether a ProductDate complies with the rules defined in this policy|
|`createdAt`|Timestamp|The timestamp when this policy was created|Automatically setting on policy creation|Tracking when this policy was created|
|`lastUpdated`|Timestamp|The timestamp when this policy was last updated|Automatically updating on policy update|Tracking when this policy was last updated|

## FeeProductRules

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`feeSchedule`|[FeeSchedule](#feeschedule)|The snapshot of the fee schedule applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy at the time of booking|Capturing the specific fee schedule for this Booking based on the Product's Fee Policy at the moment it was created|
|`lineItems`|[LineItem](#lineitem)|The snapshot of the fee line items applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy and client input on Booking POST at the time of booking|Capturing the specific fee line items for this Booking based on the Product's Fee Policy and customer input at the moment it was created|

### FeeProductDateRules

|property|type|description|derived from|evaluated when|
|---|---|---|---|---|
|`feeSchedule`|[FeeSchedule](#feeschedule)|The snapshot of the fee schedule applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy at the time of booking|Capturing the specific fee schedule for this Booking based on the Product's Fee Policy at the moment it was created|
|`lineItems`|[LineItem](#lineitem)|The snapshot of the fee line items applied to this Booking at the time of booking|Derived from parent Product's referenced Fee Policy and client input on Booking POST at the time of booking|Capturing the specific fee line items for this Booking based on the Product's Fee Policy and customer input at the moment it was created|