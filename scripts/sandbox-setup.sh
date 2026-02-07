#!/usr/bin/env bash
set -e

# Sandbox Setup Script for reserve-rec-api
# Creates isolated SSM configs and secrets for sandbox environments

SANDBOX_NAME="${1:?Usage: ./sandbox-setup.sh <sandbox-name> [base-env]}"
BASE_ENV="${2:-dev}"  # Default to dev as base
DEPLOYMENT_NAME="${BASE_ENV}-${SANDBOX_NAME}"
APP_NAME="reserveRecApi"
REGION="ca-central-1"

echo "========================================="
echo "Setting up sandbox: ${DEPLOYMENT_NAME}"
echo "Base environment: ${BASE_ENV}"
echo "========================================="
echo ""

# Define stacks that need config
STACKS=(
  "coreStack"
  "adminIdentityStack"
  "publicIdentityStack"
  "openSearchStack"
  "transactionalDataStack"
  "bookingWorkflowStack"
  "emailDispatchStack"
  "referenceDataStack"
  "adminApiStack"
  "publicApiStack"
)

echo "Step 1: Copying SSM config parameters..."
echo "----------------------------------------"

for STACK in "${STACKS[@]}"; do
  SOURCE_PATH="/${APP_NAME}/${BASE_ENV}/${STACK}/config"
  TARGET_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/${STACK}/config"
  
  echo "  ${STACK}: ${SOURCE_PATH} -> ${TARGET_PATH}"
  
  CONFIG=$(aws ssm get-parameter --region ${REGION} --name "${SOURCE_PATH}" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
  
  if [ -n "${CONFIG}" ]; then
    aws ssm put-parameter --region ${REGION} \
      --name "${TARGET_PATH}" \
      --type String \
      --value "${CONFIG}" \
      --overwrite \
      --description "Sandbox config for ${SANDBOX_NAME}" >/dev/null
    echo "    ✓ Copied"
  else
    echo "    ⚠ WARNING: Source config not found, skipping"
  fi
done

echo ""
echo "Step 2: Copying Secrets Manager secrets..."
echo "-------------------------------------------"

# Define all secrets needed
declare -A SECRETS
SECRETS["adminIdentityStack/AzureClientSecret"]="Azure OIDC client secret"
SECRETS["adminIdentityStack/BCSCClientSecret"]="BCSC client secret (admin)"
SECRETS["publicIdentityStack/BCSCClientSecret"]="BCSC client secret (public)"
SECRETS["opensearchStack/OpensearchMasterUserPassword"]="OpenSearch master password"
SECRETS["publicApiStack/MerchantId"]="Worldline merchant ID"
SECRETS["publicApiStack/HashKey"]="Worldline hash key"
SECRETS["publicApiStack/WorldlineWebhookSecret"]="Worldline webhook secret"
SECRETS["publicApiStack/qr-secret-key"]="QR code secret (public API)"
SECRETS["adminApiStack/qrSecretKey"]="QR code secret (admin API)"
SECRETS["bookingWorkflowStack/MerchantId"]="Worldline merchant ID (workflow)"
SECRETS["bookingWorkflowStack/HashKey"]="Worldline hash key (workflow)"
SECRETS["emailDispatchStack/qr-secret-key"]="QR code secret (email)"

for SECRET_PATH in "${!SECRETS[@]}"; do
  SECRET_DESC="${SECRETS[$SECRET_PATH]}"
  SOURCE_PATH="/${APP_NAME}/${BASE_ENV}/${SECRET_PATH}"
  TARGET_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/${SECRET_PATH}"
  
  echo "  ${SECRET_PATH}"
  echo "    Description: ${SECRET_DESC}"
  
  # Try to get secret value from source
  SECRET_VALUE=$(aws secretsmanager get-secret-value --region ${REGION} \
    --secret-id "${SOURCE_PATH}" --query 'SecretString' --output text 2>/dev/null || echo "")
  
  if [ -n "${SECRET_VALUE}" ]; then
    # Try to create new secret, or update if exists
    aws secretsmanager create-secret --region ${REGION} \
      --name "${TARGET_PATH}" \
      --description "Sandbox secret for ${SANDBOX_NAME}: ${SECRET_DESC}" \
      --secret-string "${SECRET_VALUE}" >/dev/null 2>&1 || \
    aws secretsmanager put-secret-value --region ${REGION} \
      --secret-id "${TARGET_PATH}" \
      --secret-string "${SECRET_VALUE}" >/dev/null
    echo "    ✓ Copied"
  else
    echo "    ⚠ WARNING: Source secret not found in ${BASE_ENV}, skipping"
  fi
done

echo ""
echo "========================================="
echo "Sandbox setup complete: ${DEPLOYMENT_NAME}"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. (Optional) Review/modify SSM configs:"
echo "     ./scripts/sandbox-edit-config.sh ${SANDBOX_NAME} <stack-key>"
echo ""
echo "  2. Deploy sandbox:"
echo "     SANDBOX_NAME=${SANDBOX_NAME} yarn sandbox:deploy"
echo ""
echo "  3. When done, tear down:"
echo "     ./scripts/sandbox-teardown.sh ${SANDBOX_NAME}"
echo ""
