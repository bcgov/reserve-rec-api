#!/usr/bin/env bash
set -e

# Sandbox Setup Script for reserve-rec-api
# Creates isolated SSM configs and secrets for sandbox environments

SANDBOX_NAME="${1:?Usage: ./sandbox-setup.sh <sandbox-name> [base-env]}"
BASE_ENV="${2:-dev}"  # Default to dev as base
DEPLOYMENT_NAME="${SANDBOX_NAME}"  # Sandboxes use just the sandbox name (not base-sandbox)
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
echo "Step 1.5: Injecting identity overrides for shared resources..."
echo "----------------------------------------------------------------"

# Sandboxes share dev's admin and public identity resources (user pools, identity pools)
# We inject these as overrides so the identity stacks skip creation and just export dev's values

# Helper function to inject overrides into a config
inject_identity_overrides() {
  local STACK_NAME=$1
  local CONFIG_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/${STACK_NAME}/config"
  
  echo "  ${STACK_NAME}:"
  
  # Get current config
  CURRENT_CONFIG=$(aws ssm get-parameter --region ${REGION} --name "${CONFIG_PATH}" --query 'Parameter.Value' --output text 2>/dev/null || echo "{}")
  
  if [ "$CURRENT_CONFIG" == "{}" ]; then
    echo "    ⚠ WARNING: Config not found, skipping override injection"
    return
  fi
  
  # Build overrides JSON based on stack type
  if [ "$STACK_NAME" == "adminIdentityStack" ]; then
    # Read dev's admin identity exports
    ADMIN_USER_POOL_ID=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/adminUserPoolId" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    ADMIN_USER_POOL_CLIENT_ID=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/adminUserPoolClientId" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    ADMIN_IDENTITY_POOL_ID=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/adminIdentityPoolId" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    ADMIN_USER_POOL_PROVIDER_NAME=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/adminUserPoolProviderName" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    ADMIN_USER_POOL_DOMAIN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/adminUserPoolDomain" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    COGNITO_AUTH_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/cognitoAuthRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    COGNITO_UNAUTH_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/cognitoUnauthRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    SUPER_ADMIN_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/superAdminRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    ADMINISTRATOR_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/administratorRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    PARK_OPERATOR_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/adminIdentityStack/parkOperatorRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    
    OVERRIDES_JSON=$(cat <<EOF
{
  "skipCreation": true,
  "adminUserPoolId": "${ADMIN_USER_POOL_ID}",
  "adminUserPoolClientId": "${ADMIN_USER_POOL_CLIENT_ID}",
  "adminIdentityPoolId": "${ADMIN_IDENTITY_POOL_ID}",
  "adminUserPoolProviderName": "${ADMIN_USER_POOL_PROVIDER_NAME}",
  "adminUserPoolDomain": "${ADMIN_USER_POOL_DOMAIN}",
  "cognitoAuthRoleArn": "${COGNITO_AUTH_ROLE_ARN}",
  "cognitoUnauthRoleArn": "${COGNITO_UNAUTH_ROLE_ARN}",
  "superAdminRoleArn": "${SUPER_ADMIN_ROLE_ARN}",
  "administratorRoleArn": "${ADMINISTRATOR_ROLE_ARN}",
  "parkOperatorRoleArn": "${PARK_OPERATOR_ROLE_ARN}"
}
EOF
)
  elif [ "$STACK_NAME" == "publicIdentityStack" ]; then
    # Read dev's public identity exports
    PUBLIC_USER_POOL_ID=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/publicIdentityStack/publicUserPoolId" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    PUBLIC_USER_POOL_CLIENT_ID=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/publicIdentityStack/publicUserPoolClientId" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    PUBLIC_IDENTITY_POOL_ID=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/publicIdentityStack/publicIdentityPoolId" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    COGNITO_AUTH_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/publicIdentityStack/cognitoAuthRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    COGNITO_UNAUTH_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/publicIdentityStack/cognitoUnauthRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    PUBLIC_ROLE_ARN=$(aws ssm get-parameter --region ${REGION} --name "/${APP_NAME}/${BASE_ENV}/publicIdentityStack/publicRoleArn" --query 'Parameter.Value' --output text 2>/dev/null || echo "")
    
    OVERRIDES_JSON=$(cat <<EOF
{
  "skipCreation": true,
  "publicUserPoolId": "${PUBLIC_USER_POOL_ID}",
  "publicUserPoolClientId": "${PUBLIC_USER_POOL_CLIENT_ID}",
  "publicIdentityPoolId": "${PUBLIC_IDENTITY_POOL_ID}",
  "cognitoAuthRoleArn": "${COGNITO_AUTH_ROLE_ARN}",
  "cognitoUnauthRoleArn": "${COGNITO_UNAUTH_ROLE_ARN}",
  "publicRoleArn": "${PUBLIC_ROLE_ARN}"
}
EOF
)
  else
    echo "    Unknown stack type"
    return
  fi
  
  # Merge overrides into current config using jq
  # This preserves any existing overrides (like opensearchDomainArn) and adds identity overrides
  UPDATED_CONFIG=$(echo "${CURRENT_CONFIG}" | jq --argjson newOverrides "${OVERRIDES_JSON}" '
    .overrides = (.overrides // {}) * $newOverrides
  ')
  
  # Update SSM parameter
  aws ssm put-parameter --region ${REGION} \
    --name "${CONFIG_PATH}" \
    --type String \
    --value "${UPDATED_CONFIG}" \
    --overwrite >/dev/null
  
  echo "    ✓ Overrides injected"
}

# Inject overrides for both identity stacks
inject_identity_overrides "adminIdentityStack"
inject_identity_overrides "publicIdentityStack"

echo ""
echo "Step 1.6: Copying frontend domain parameter..."
echo "------------------------------------------------"

# Frontend domain uses a different app name prefix (/reserve-rec vs /reserveRecApi)
# Copy dev's frontend domain for sandbox use
FRONTEND_DOMAIN=$(aws ssm get-parameter --region ${REGION} --name "/reserve-rec/${BASE_ENV}/public-frontend-domain" --query 'Parameter.Value' --output text 2>/dev/null || echo "")

if [ -n "${FRONTEND_DOMAIN}" ]; then
  echo "  Copying: /reserve-rec/${BASE_ENV}/public-frontend-domain -> /reserve-rec/${DEPLOYMENT_NAME}/public-frontend-domain"
  echo "    Value: ${FRONTEND_DOMAIN}"
  aws ssm put-parameter --region ${REGION} \
    --name "/reserve-rec/${DEPLOYMENT_NAME}/public-frontend-domain" \
    --type String \
    --value "${FRONTEND_DOMAIN}" \
    --overwrite \
    --description "Frontend domain for ${SANDBOX_NAME} (shared from ${BASE_ENV})" >/dev/null
  echo "    ✓ Copied"
else
  echo "  ⚠ WARNING: Frontend domain parameter not found in ${BASE_ENV}, skipping"
fi

echo ""
echo "Step 2: Copying Secrets Manager secrets..."
echo "-------------------------------------------"

# Define secret mappings with explicit source->target paths
# Format: "source_path|target_path"="description"
# Paths differ due to naming convention changes between when dev secrets were created
# and current code expectations (pre/post Jan 22, 2026 secret naming fix)
declare -A SECRET_MAPPINGS

# Identity stack secrets
SECRET_MAPPINGS["adminIdentityStack/azureClientSecret|adminIdentityStack/AzureClientSecret"]="Azure OIDC client secret"
SECRET_MAPPINGS["adminIdentityStack/bcscClientSecret|adminIdentityStack/bcscClientSecret"]="BCSC client secret (admin)"
SECRET_MAPPINGS["publicIdentityStack/bcscClientSecret|publicIdentityStack/bcscClientSecret"]="BCSC client secret (public)"

# QR code secrets
SECRET_MAPPINGS["adminApiStack/qr-secret-key|adminApiStack/qrSecretKey"]="QR code secret (admin API)"
SECRET_MAPPINGS["publicApiStack/qr-secret-key|publicApiStack/qr-secret-key"]="QR code secret (public API)"

# Worldline payment secrets
SECRET_MAPPINGS["publicApiStack/merchantId|publicApiStack/MerchantId"]="Worldline merchant ID (public)"
SECRET_MAPPINGS["publicApiStack/hashKey|publicApiStack/HashKey"]="Worldline hash key (public)"
SECRET_MAPPINGS["publicApiStack/worldlineWebhookSecret|publicApiStack/WorldlineWebhookSecret"]="Worldline webhook secret"
SECRET_MAPPINGS["bookingWorkflowStack/merchantId|bookingWorkflowStack/MerchantId"]="Worldline merchant ID (workflow)"
SECRET_MAPPINGS["bookingWorkflowStack/hashKey|bookingWorkflowStack/HashKey"]="Worldline hash key (workflow)"

# Note: OpenSearch password not needed - sandboxes reuse dev domain via SSM config overrides
# Note: emailDispatchStack/qr-secret-key removed - doesn't exist in dev environment

for MAPPING in "${!SECRET_MAPPINGS[@]}"; do
  DESC="${SECRET_MAPPINGS[$MAPPING]}"
  
  # Parse source|target mapping
  if [[ "$MAPPING" == *"|"* ]]; then
    SOURCE_RELATIVE="${MAPPING%|*}"  # Before pipe
    TARGET_RELATIVE="${MAPPING#*|}"  # After pipe
  else
    # No explicit mapping, use same path for both
    SOURCE_RELATIVE="$MAPPING"
    TARGET_RELATIVE="$MAPPING"
  fi
  
  SOURCE_PATH="/${APP_NAME}/${BASE_ENV}/${SOURCE_RELATIVE}"
  TARGET_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/${TARGET_RELATIVE}"
  
  echo "  ${TARGET_RELATIVE}"
  echo "    Source: ${SOURCE_PATH}"
  echo "    Description: ${DESC}"
  
  # Try to get secret value from source
  SECRET_VALUE=$(aws secretsmanager get-secret-value --region ${REGION} \
    --secret-id "${SOURCE_PATH}" --query 'SecretString' --output text 2>/dev/null || echo "")
  
  if [ -n "${SECRET_VALUE}" ]; then
    # Try to create new secret, or update if exists
    aws secretsmanager create-secret --region ${REGION} \
      --name "${TARGET_PATH}" \
      --description "Sandbox secret for ${SANDBOX_NAME}: ${DESC}" \
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
