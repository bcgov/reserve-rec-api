#!/bin/bash
set -e

# Sandbox Config Editor for reserve-rec-api
# Allows editing individual stack configs in SSM

SANDBOX_NAME="${1:?Usage: ./sandbox-edit-config.sh <sandbox-name> <stack-key> [base-env]}"
STACK_KEY="${2:?Usage: ./sandbox-edit-config.sh <sandbox-name> <stack-key> [base-env]}"
BASE_ENV="${3:-dev}"
DEPLOYMENT_NAME="${BASE_ENV}-${SANDBOX_NAME}"
APP_NAME="reserveRecApi"
REGION="ca-central-1"

PARAM_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/${STACK_KEY}/config"
TEMP_FILE=$(mktemp)

echo "Editing config for ${STACK_KEY} in sandbox ${SANDBOX_NAME}"
echo "SSM Path: ${PARAM_PATH}"
echo ""

# Get current config
CONFIG=$(aws ssm get-parameter --region ${REGION} --name "${PARAM_PATH}" \
  --query 'Parameter.Value' --output text 2>/dev/null || echo "")

if [ -z "${CONFIG}" ]; then
  echo "ERROR: Config not found at ${PARAM_PATH}"
  echo "Have you run sandbox-setup.sh yet?"
  exit 1
fi

# Format as pretty JSON and save to temp file
echo "${CONFIG}" | jq '.' > "${TEMP_FILE}"

# Open in editor (respects $EDITOR env var, defaults to vim)
${EDITOR:-vim} "${TEMP_FILE}"

# Validate JSON
if ! jq empty "${TEMP_FILE}" 2>/dev/null; then
  echo "ERROR: Invalid JSON in edited file"
  rm "${TEMP_FILE}"
  exit 1
fi

# Confirm update
echo ""
echo "Review changes and update SSM parameter?"
read -p "Type 'yes' to update: " CONFIRM

if [ "$CONFIRM" = "yes" ]; then
  # Compact JSON for SSM
  CONFIG_COMPACT=$(cat "${TEMP_FILE}" | jq -c '.')
  
  aws ssm put-parameter --region ${REGION} \
    --name "${PARAM_PATH}" \
    --type String \
    --value "${CONFIG_COMPACT}" \
    --overwrite >/dev/null
  
  echo "✓ Config updated successfully"
  echo ""
  echo "Note: You'll need to redeploy the stack for changes to take effect:"
  echo "  SANDBOX_NAME=${SANDBOX_NAME} yarn sandbox:deploy"
else
  echo "Update cancelled"
fi

rm "${TEMP_FILE}"
