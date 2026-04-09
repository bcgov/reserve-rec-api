#!/usr/bin/env bash
set -e

# Prod Setup Script for reserve-rec-api
# Seeds SSM configs from test environment (cross-account) and creates prod secrets.
# Test account: 623829546818 (profile: 623829546818_BCGOV_LZA_Admin)
# Prod account: 628373393242 (profile: 628373393242_BCGOV_LZA_Admin)

BASE_ENV="${1:-test}"
APP_NAME="reserveRecApi"
DEPLOYMENT_NAME="prod"
REGION="ca-central-1"
SOURCE_PROFILE="623829546818_BCGOV_LZA_Admin"
TARGET_PROFILE="628373393242_BCGOV_LZA_Admin"

echo "========================================="
echo "Setting up prod environment"
echo "Source: ${BASE_ENV} (${SOURCE_PROFILE})"
echo "Target: prod (${TARGET_PROFILE})"
echo "========================================="
echo ""

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
  "waitingRoomStack"
)

echo "Step 1: Copying SSM config parameters from ${BASE_ENV} to prod..."
echo "-------------------------------------------------------------------"

for STACK in "${STACKS[@]}"; do
  SOURCE_PATH="/${APP_NAME}/${BASE_ENV}/${STACK}/config"
  TARGET_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/${STACK}/config"

  echo "  ${STACK}: ${SOURCE_PATH} -> ${TARGET_PATH}"

  CONFIG=$(aws ssm get-parameter \
    --profile "${SOURCE_PROFILE}" \
    --region "${REGION}" \
    --name "${SOURCE_PATH}" \
    --query 'Parameter.Value' --output text 2>/dev/null || echo "")

  if [ -n "${CONFIG}" ]; then
    aws ssm put-parameter \
      --profile "${TARGET_PROFILE}" \
      --region "${REGION}" \
      --name "${TARGET_PATH}" \
      --type String \
      --value "${CONFIG}" \
      --overwrite \
      --description "Prod config for ${STACK}" >/dev/null
    echo "    ✓ Copied"
  else
    echo "    ⚠ WARNING: Source config not found in ${BASE_ENV}, skipping"
  fi
done

echo ""
echo "Step 2: Applying prod-specific config overrides..."
echo "---------------------------------------------------"

# Override OpenSearch instance type — size up one from t3.small.search
OS_CONFIG_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/openSearchStack/config"
echo "  openSearchStack: setting opensearchInstanceType to t3.medium.search"

CURRENT_OS_CONFIG=$(aws ssm get-parameter \
  --profile "${TARGET_PROFILE}" \
  --region "${REGION}" \
  --name "${OS_CONFIG_PATH}" \
  --query 'Parameter.Value' --output text 2>/dev/null || echo "{}")

UPDATED_OS_CONFIG=$(echo "${CURRENT_OS_CONFIG}" | jq '.opensearchInstanceType = "t3.medium.search"')

aws ssm put-parameter \
  --profile "${TARGET_PROFILE}" \
  --region "${REGION}" \
  --name "${OS_CONFIG_PATH}" \
  --type String \
  --value "${UPDATED_OS_CONFIG}" \
  --overwrite >/dev/null
echo "    ✓ Updated"

echo ""
echo "Step 3: Generating originVerifySecret..."
echo "-----------------------------------------"

ORIGIN_VERIFY_SSM_PATH="/${APP_NAME}/${DEPLOYMENT_NAME}/originVerifySecret"

EXISTING=$(aws ssm get-parameter \
  --profile "${TARGET_PROFILE}" \
  --region "${REGION}" \
  --name "${ORIGIN_VERIFY_SSM_PATH}" \
  --query 'Parameter.Value' --output text 2>/dev/null || echo "")

if [ -n "${EXISTING}" ]; then
  echo "  ✓ Already exists, skipping"
else
  NEW_SECRET=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
  aws ssm put-parameter \
    --profile "${TARGET_PROFILE}" \
    --region "${REGION}" \
    --name "${ORIGIN_VERIFY_SSM_PATH}" \
    --type String \
    --value "${NEW_SECRET}" \
    --description "Shared secret for CloudFront X-Origin-Verify header (WAF enforcement) — prod" >/dev/null
  echo "  ✓ Created: ${ORIGIN_VERIFY_SSM_PATH}"
fi

echo ""
echo "Step 4: Creating QR code signing secrets (new random values)..."
echo "----------------------------------------------------------------"

create_or_skip_secret() {
  local SECRET_PATH="$1"
  local SECRET_VALUE="$2"
  local DESC="$3"

  EXISTING=$(aws secretsmanager describe-secret \
    --profile "${TARGET_PROFILE}" \
    --region "${REGION}" \
    --secret-id "${SECRET_PATH}" 2>/dev/null || echo "")

  if [ -n "${EXISTING}" ]; then
    echo "    ✓ Already exists, skipping: ${SECRET_PATH}"
  else
    aws secretsmanager create-secret \
      --profile "${TARGET_PROFILE}" \
      --region "${REGION}" \
      --name "${SECRET_PATH}" \
      --description "${DESC}" \
      --secret-string "${SECRET_VALUE}" >/dev/null
    echo "    ✓ Created: ${SECRET_PATH}"
  fi
}

QR_KEY_ADMIN=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")
QR_KEY_PUBLIC=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")

echo "  adminApiStack/qrSecretKey"
create_or_skip_secret \
  "/${APP_NAME}/${DEPLOYMENT_NAME}/adminApiStack/qrSecretKey" \
  "${QR_KEY_ADMIN}" \
  "QR code signing secret (admin API) — prod"

echo "  publicApiStack/qr-secret-key"
create_or_skip_secret \
  "/${APP_NAME}/${DEPLOYMENT_NAME}/publicApiStack/qr-secret-key" \
  "${QR_KEY_PUBLIC}" \
  "QR code signing secret (public API) — prod"

echo ""
echo "Step 5: Creating identity placeholder secrets (BCSC/Azure — update with prod creds later)..."
echo "---------------------------------------------------------------------------------------------"

# These are placeholders. Replace with real prod credentials when available.
echo "  adminIdentityStack/AzureClientSecret (placeholder)"
create_or_skip_secret \
  "/${APP_NAME}/${DEPLOYMENT_NAME}/adminIdentityStack/AzureClientSecret" \
  "REPLACE_WITH_PROD_AZURE_CLIENT_SECRET" \
  "Azure OIDC client secret — prod (placeholder, update before enabling SSO)"

echo "  adminIdentityStack/bcscClientSecret (placeholder)"
create_or_skip_secret \
  "/${APP_NAME}/${DEPLOYMENT_NAME}/adminIdentityStack/bcscClientSecret" \
  "REPLACE_WITH_PROD_BCSC_CLIENT_SECRET" \
  "BCSC client secret (admin) — prod (placeholder, update before enabling BCSC login)"

echo "  publicIdentityStack/bcscClientSecret (placeholder)"
create_or_skip_secret \
  "/${APP_NAME}/${DEPLOYMENT_NAME}/publicIdentityStack/bcscClientSecret" \
  "REPLACE_WITH_PROD_BCSC_CLIENT_SECRET" \
  "BCSC client secret (public) — prod (placeholder, update before enabling BCSC login)"

echo ""
echo "Step 6: Copying frontend domain parameter..."
echo "---------------------------------------------"
echo "  NOTE: /reserve-rec/prod/public-frontend-domain must be set AFTER the first"
echo "  CDK deploy once the CloudFront domain is known. Skipping for now."
echo ""

echo "========================================="
echo "Prod setup complete"
echo "========================================="
echo ""
echo "Next steps:"
echo "  1. Deploy API stacks:"
echo "     AWS_PROFILE=${TARGET_PROFILE} cdk deploy -c @context=prod --all --require-approval never --rollback"
echo ""
echo "  2. After deploy, set frontend domain SSM param:"
echo "     aws ssm put-parameter --profile ${TARGET_PROFILE} --region ${REGION} \\"
echo "       --name /reserve-rec/prod/public-frontend-domain \\"
echo "       --type String --value <cloudfront-domain> --overwrite"
echo ""
echo "  3. When prod BCSC/Azure credentials are available, update the placeholder secrets."
echo ""
