#!/bin/bash

echo "DynamoDB Table Data Copy Script"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo "Error: AWS CLI is not installed"
  exit 1
fi


# Function to list all DynamoDB tables
list_tables() {
  aws dynamodb list-tables --query 'TableNames' --output text
}

# Function to select a table
select_table() {
  local prompt="$1"
  echo "$prompt" >&2
  tables=($(list_tables))

  if [ ${#tables[@]} -eq 0 ]; then
    echo "Error: No DynamoDB tables found" >&2
    exit 1
  fi

  select table in "${tables[@]}"; do
    if [ -n "$table" ]; then
      echo "$table"
      return
    fi
  done
}

# Select source and target tables
echo "Select source table:"
SOURCE_TABLE=$(select_table)
echo "Select target table:"
TARGET_TABLE=$(select_table)

if [ "$SOURCE_TABLE" == "$TARGET_TABLE" ]; then
  echo "Error: Source and target tables cannot be the same"
  exit 1
fi

# Display summary and ask for confirmation
echo ""
echo "======================================"
echo "Copy Operation Summary"
echo "======================================"
echo "Source Table: $SOURCE_TABLE"
echo "Target Table: $TARGET_TABLE"
echo ""

echo "Counting items in source table..."
TOTAL_ITEMS=$(aws dynamodb scan --table-name "$SOURCE_TABLE" --select COUNT --output json | jq -r '.Count')
echo "Total items to copy: $TOTAL_ITEMS"
echo ""

read -p "Do you want to proceed with copying $TOTAL_ITEMS items? (yes/no): " confirmation
if [[ ! "$confirmation" =~ ^[Yy][Ee][Ss]$ ]]; then
  echo "Operation cancelled by user"
  exit 0
fi

echo ""
echo "Copying data from '$SOURCE_TABLE' to '$TARGET_TABLE'..."

# Scan source table and write to target table using batch writes
TEMP_FILE=$(mktemp)
BATCH_FILE=$(mktemp)
trap "rm -f $TEMP_FILE $BATCH_FILE" EXIT

aws dynamodb scan --table-name "$SOURCE_TABLE" --output json | \
jq -c '.Items[]' > "$TEMP_FILE"

counter=0
batch=()

while read -r item; do
  # Add item to batch
  batch+=("$item")
  ((counter++))

  # When batch reaches 25 items or we're at the end, write the batch
  if [ ${#batch[@]} -eq 25 ] || [ $counter -eq $TOTAL_ITEMS ]; then
    # Build batch write request
    printf '{"'$TARGET_TABLE'":[' > "$BATCH_FILE"
    first=true
    for batch_item in "${batch[@]}"; do
      if [ "$first" = true ]; then
        first=false
      else
        printf ',' >> "$BATCH_FILE"
      fi
      printf '{"PutRequest":{"Item":%s}}' "$batch_item" >> "$BATCH_FILE"
    done
    printf ']}' >> "$BATCH_FILE"

    # Execute batch write
    aws dynamodb batch-write-item --request-items file://"$BATCH_FILE" > /dev/null 2>&1 || {
      echo "Warning: Failed to write batch starting at item $((counter - ${#batch[@]}))"
    }

    echo "Progress: $counter / $TOTAL_ITEMS items copied ($(( counter * 100 / TOTAL_ITEMS ))%)"

    # Reset batch
    batch=()
  fi
done < "$TEMP_FILE"

echo "Data copy completed successfully! Total items copied: $counter"