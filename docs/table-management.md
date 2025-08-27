# DynamoDB Table Management with Parameter Store

This solution provides a way to manage Dynamo tables independently of your main CDK stack lifecycle, solving the orphaned / "table already exists" issue when redeploying stacks.

## Overview

1. Checks for existing tables and stores their ARNs in Parameter Store
2. Parameter Store acts as a central registry for table references
3. The CDK stack reads table ARNs from Parameter Store and uses existing tables

## Setup Instructions

### Step 1: Deploy the `TableManager` Stack

```bash
# Deploy the TableManager infrastructure
cd /reserve-rec-api
cdk deploy ReserveRecTableManager --app "node bin/table-manager.js"
```

### Step 2: Run the `Table Manager` for Your Stack

#### For Default Stack (ReserveRecCdkStack)
```bash
# Tables: reserve-rec-main, reserve-rec-audit, reserve-rec-pubsub
# Parameter Store: /reserve-rec/main/tables/*/arn
TM_FUNCTION_NAME="ReserveRecTableManager-TableManagerFunction123ABC"

node scripts/manage-tables.js $TM_FUNCTION_NAME
# OR
node scripts/manage-tables.js $TM_FUNCTION_NAME ReserveRecCdkStack
```

#### For Custom Stack (e.g., "test")
```bash
# Tables: reserve-rec-main-test, reserve-rec-audit-test, reserve-rec-pubsub-test  
# Parameter Store: /reserve-rec/test/tables/*/arn
TM_FUNCTION_NAME="ReserveRecTableManager-TableManagerFunction123ABC"
STACK_NAME="test"

node scripts/manage-tables.js $TM_FUNCTION_NAME $STACK_NAME
```

### Step 3: Deploy Your Main Stack

#### For Default Stack
```bash
# Deploys as ReserveRecCdkStack, uses Parameter Store /reserve-rec/main/tables/*/arn
cdk deploy
```

#### For Custom Stack  
```bash
# Deploys as "test" stack, uses Parameter Store /reserve-rec/test/tables/*/arn
STACK_NAME=test cdk deploy test
```

## How It Works

### Table Lookup Flow

1. Try to get table ARNs from Parameter Store
2. If Parameter Store lookup fails, create tables via CDK

### Parameter Store Structure

#### Default Stack (ReserveRecCdkStack)
```
/reserve-rec/main/tables/main/arn     -> arn:aws:dynamodb:region:account:table/reserve-rec-main
/reserve-rec/main/tables/audit/arn    -> arn:aws:dynamodb:region:account:table/reserve-rec-audit
/reserve-rec/main/tables/pubsub/arn   -> arn:aws:dynamodb:region:account:table/reserve-rec-pubsub
```

#### Custom Stack (e.g., "test")
```
/reserve-rec/test/tables/main/arn     -> arn:aws:dynamodb:region:account:table/reserve-rec-main-test
/reserve-rec/test/tables/audit/arn    -> arn:aws:dynamodb:region:account:table/reserve-rec-audit-test
/reserve-rec/test/tables/pubsub/arn   -> arn:aws:dynamodb:region:account:table/reserve-rec-pubsub-test
```

## Troubleshooting

### Tables don't exist yet

If you're starting fresh and tables don't exist:

1. Create them manually in AWS Console, or
2. Let the CDK fallback create them, then run the `TableManager` to register them

### Parameter Store access issues

Ensure your deployment role has permissions:
```json
{
  "Effect": "Allow",
  "Action": [
    "ssm:GetParameter",
    "ssm:PutParameter"
  ],
  "Resource": "arn:aws:ssm:*:*:parameter/reserve-rec/*"
}
```

### `TableManager` Lambda not found

Check CloudFormation outputs for the exact function name:
```bash
aws cloudformation describe-stacks --stack-name ReserveRecTableManager --query 'Stacks[0].Outputs'
```

## Manual Parameter Store Management

You can also manually manage parameters:

```bash
# Store a table ARN manually
aws ssm put-parameter \
  --name "/reserve-rec/test/tables/main/arn" \
  --value "arn:aws:dynamodb:ca-central-1:637423314715:table/reserve-rec-main-test" \
  --type "String" \
  --overwrite

# Get a table ARN
aws ssm get-parameter --name "/reserve-rec/test/tables/main/arn" --query 'Parameter.Value' --output text
```
