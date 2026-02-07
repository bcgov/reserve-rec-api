#!/usr/bin/env bash
set -e

# sandbox-seed-config.sh
# Seeds the DynamoDB config entries and updates Cognito callback URLs for a sandbox deployment.
#
# This script should be run AFTER:
#   1. API sandbox is deployed (creates Cognito pools, API Gateway, DynamoDB tables)
#   2. Frontend sandboxes are deployed (creates CloudFront distributions)
#
# This script should be run BEFORE:
#   - Redeploying identity stacks (to update Cognito callback URLs)
#   - Publishing frontend apps (they need the DynamoDB config to exist)
#
# Usage: ./scripts/sandbox-seed-config.sh <sandbox-name> [base-env]
# Example: ./scripts/sandbox-seed-config.sh sparky dev

SANDBOX_NAME="${1:?Usage: ./scripts/sandbox-seed-config.sh <sandbox-name> [base-env]}"
BASE_ENV="${2:-dev}"
DEPLOYMENT_NAME="${BASE_ENV}-${SANDBOX_NAME}"
REGION="${AWS_REGION:-ca-central-1}"

echo ""
echo "========================================================"
echo "  SANDBOX CONFIG SEEDER"
echo "========================================================"
echo "  Sandbox:    ${DEPLOYMENT_NAME}"
echo "  Region:     ${REGION}"
echo "========================================================"
echo ""

# =============================================================================
# Helper function to get SSM parameter
# =============================================================================
get_ssm() {
  local path="$1"
  aws ssm get-parameter --region "${REGION}" --name "${path}" --query 'Parameter.Value' --output text 2>/dev/null || echo ""
}

# =============================================================================
# STEP 1: Fetch all required values from SSM
# =============================================================================
echo "Step 1: Fetching values from SSM..."

# Admin values
ADMIN_API_URL=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/adminApiStack/adminApiUrl")
ADMIN_USER_POOL_ID=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/adminIdentityStack/adminUserPoolId")
ADMIN_USER_POOL_CLIENT_ID=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/adminIdentityStack/adminUserPoolClientId")
ADMIN_IDENTITY_POOL_ID=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/adminIdentityStack/adminIdentityPoolId")
ADMIN_USER_POOL_DOMAIN=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/adminIdentityStack/adminUserPoolDomain")
ADMIN_CLOUDFRONT=$(get_ssm "/reserveRecAdmin/${DEPLOYMENT_NAME}/distributionStack/distributionDomainName")

# Public values
PUBLIC_API_URL=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/publicApiStack/publicApiUrl")
PUBLIC_USER_POOL_ID=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/publicIdentityStack/publicUserPoolId")
PUBLIC_USER_POOL_CLIENT_ID=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/publicIdentityStack/publicUserPoolClientId")
PUBLIC_IDENTITY_POOL_ID=$(get_ssm "/reserveRecApi/${DEPLOYMENT_NAME}/publicIdentityStack/publicIdentityPoolId")
PUBLIC_CLOUDFRONT=$(get_ssm "/reserveRecPublic/${DEPLOYMENT_NAME}/distributionStack/distributionDomainName")

# Validate required values
missing_values=()
[ -z "$ADMIN_API_URL" ] && missing_values+=("ADMIN_API_URL")
[ -z "$ADMIN_USER_POOL_ID" ] && missing_values+=("ADMIN_USER_POOL_ID")
[ -z "$ADMIN_USER_POOL_CLIENT_ID" ] && missing_values+=("ADMIN_USER_POOL_CLIENT_ID")
[ -z "$ADMIN_IDENTITY_POOL_ID" ] && missing_values+=("ADMIN_IDENTITY_POOL_ID")
[ -z "$ADMIN_CLOUDFRONT" ] && missing_values+=("ADMIN_CLOUDFRONT")
[ -z "$PUBLIC_API_URL" ] && missing_values+=("PUBLIC_API_URL")
[ -z "$PUBLIC_USER_POOL_ID" ] && missing_values+=("PUBLIC_USER_POOL_ID")
[ -z "$PUBLIC_USER_POOL_CLIENT_ID" ] && missing_values+=("PUBLIC_USER_POOL_CLIENT_ID")
[ -z "$PUBLIC_IDENTITY_POOL_ID" ] && missing_values+=("PUBLIC_IDENTITY_POOL_ID")
[ -z "$PUBLIC_CLOUDFRONT" ] && missing_values+=("PUBLIC_CLOUDFRONT")

if [ ${#missing_values[@]} -gt 0 ]; then
  echo ""
  echo "ERROR: Missing required SSM values:"
  for val in "${missing_values[@]}"; do
    echo "  - ${val}"
  done
  echo ""
  echo "Make sure both the API and frontend sandboxes are deployed first."
  exit 1
fi

echo "  Admin API URL:        ${ADMIN_API_URL}"
echo "  Admin CloudFront:     ${ADMIN_CLOUDFRONT}"
echo "  Admin User Pool:      ${ADMIN_USER_POOL_ID}"
echo "  Public API URL:       ${PUBLIC_API_URL}"
echo "  Public CloudFront:    ${PUBLIC_CLOUDFRONT}"
echo "  Public User Pool:     ${PUBLIC_USER_POOL_ID}"
echo ""

# Construct domain URLs
ADMIN_USER_POOL_DOMAIN_URL="${ADMIN_USER_POOL_DOMAIN}.auth.${REGION}.amazoncognito.com"
PUBLIC_USER_POOL_DOMAIN_URL="reserve-rec-public-identity-${DEPLOYMENT_NAME}.auth.${REGION}.amazoncognito.com"

# =============================================================================
# STEP 2: Create DynamoDB config entries
# =============================================================================
echo "Step 2: Creating DynamoDB config entries..."

TABLE_NAME="ReserveRecApi-Dev-${SANDBOX_NAME}-ReferenceDataStack-ReferenceDataTable"

# Admin config item
echo "  Creating admin config..."
aws dynamodb put-item --region "${REGION}" --table-name "${TABLE_NAME}" --item '{
  "pk": {"S": "config"},
  "sk": {"S": "admin"},
  "ENVIRONMENT": {"S": "'"${DEPLOYMENT_NAME}"'"},
  "API_LOCATION": {"S": "'"${ADMIN_API_URL}"'"},
  "ADMIN_USER_POOL_ID": {"S": "'"${ADMIN_USER_POOL_ID}"'"},
  "ADMIN_USER_POOL_CLIENT_ID": {"S": "'"${ADMIN_USER_POOL_CLIENT_ID}"'"},
  "ADMIN_IDENTITY_POOL_ID": {"S": "'"${ADMIN_IDENTITY_POOL_ID}"'"},
  "ADMIN_USER_POOL_DOMAIN_URL": {"S": "'"${ADMIN_USER_POOL_DOMAIN_URL}"'"},
  "COGNITO_REDIRECT_URI": {"S": "https://'"${ADMIN_CLOUDFRONT}"'"}
}'
echo "    Done."

# Public config item
echo "  Creating public config..."
aws dynamodb put-item --region "${REGION}" --table-name "${TABLE_NAME}" --item '{
  "pk": {"S": "config"},
  "sk": {"S": "public"},
  "ENVIRONMENT": {"S": "'"${DEPLOYMENT_NAME}"'"},
  "API_LOCATION": {"S": "'"${PUBLIC_API_URL}"'"},
  "PUBLIC_USER_POOL_ID": {"S": "'"${PUBLIC_USER_POOL_ID}"'"},
  "PUBLIC_USER_POOL_CLIENT_ID": {"S": "'"${PUBLIC_USER_POOL_CLIENT_ID}"'"},
  "PUBLIC_IDENTITY_POOL_ID": {"S": "'"${PUBLIC_IDENTITY_POOL_ID}"'"},
  "PUBLIC_USER_POOL_DOMAIN_URL": {"S": "'"${PUBLIC_USER_POOL_DOMAIN_URL}"'"},
  "COGNITO_REDIRECT_URI": {"S": "https://'"${PUBLIC_CLOUDFRONT}"'"}
}'
echo "    Done."
echo ""

# =============================================================================
# STEP 3: Update Admin Identity SSM config with sandbox CloudFront URLs
# =============================================================================
echo "Step 3: Updating Admin Identity SSM config with sandbox CloudFront URLs..."

ADMIN_IDENTITY_CONFIG_PATH="/reserveRecApi/${DEPLOYMENT_NAME}/adminIdentityStack/config"
ADMIN_IDENTITY_CONFIG=$(get_ssm "${ADMIN_IDENTITY_CONFIG_PATH}")

if [ -z "$ADMIN_IDENTITY_CONFIG" ]; then
  echo "  WARNING: Could not find admin identity config at ${ADMIN_IDENTITY_CONFIG_PATH}"
  echo "  Skipping Cognito URL update for admin."
else
  # Add sandbox CloudFront URLs to callback and logout arrays if not present
  UPDATED_ADMIN_CONFIG=$(echo "${ADMIN_IDENTITY_CONFIG}" | jq --arg cf "https://${ADMIN_CLOUDFRONT}" --arg cf_slash "https://${ADMIN_CLOUDFRONT}/" --arg cf_logout "https://${ADMIN_CLOUDFRONT}/logout" '
    # Add to azureCallbackUrls if not present
    .azureCallbackUrls = (
      if .azureCallbackUrls then
        (.azureCallbackUrls + [$cf, $cf_slash] | unique)
      else
        [$cf, $cf_slash]
      end
    ) |
    # Add to azureLogoutUrls if not present
    .azureLogoutUrls = (
      if .azureLogoutUrls then
        (.azureLogoutUrls + [$cf, $cf_logout] | unique)
      else
        [$cf, $cf_logout]
      end
    )
  ')

  aws ssm put-parameter --region "${REGION}" \
    --name "${ADMIN_IDENTITY_CONFIG_PATH}" \
    --type String \
    --value "${UPDATED_ADMIN_CONFIG}" \
    --overwrite >/dev/null

  echo "  Added https://${ADMIN_CLOUDFRONT} to admin callback/logout URLs."
fi
echo ""

# =============================================================================
# STEP 4: Update Public Identity SSM config with sandbox CloudFront URLs
# =============================================================================
echo "Step 4: Updating Public Identity SSM config with sandbox CloudFront URLs..."

PUBLIC_IDENTITY_CONFIG_PATH="/reserveRecApi/${DEPLOYMENT_NAME}/publicIdentityStack/config"
PUBLIC_IDENTITY_CONFIG=$(get_ssm "${PUBLIC_IDENTITY_CONFIG_PATH}")

if [ -z "$PUBLIC_IDENTITY_CONFIG" ]; then
  echo "  WARNING: Could not find public identity config at ${PUBLIC_IDENTITY_CONFIG_PATH}"
  echo "  Skipping Cognito URL update for public."
else
  # Add sandbox CloudFront URLs to callback and logout arrays if not present
  UPDATED_PUBLIC_CONFIG=$(echo "${PUBLIC_IDENTITY_CONFIG}" | jq --arg cf "https://${PUBLIC_CLOUDFRONT}" --arg cf_slash "https://${PUBLIC_CLOUDFRONT}/" --arg cf_logout "https://${PUBLIC_CLOUDFRONT}/logout" '
    # Add to publicCognitoCallbackUrls if not present
    .publicCognitoCallbackUrls = (
      if .publicCognitoCallbackUrls then
        (.publicCognitoCallbackUrls + [$cf, $cf_slash] | unique)
      else
        [$cf, $cf_slash]
      end
    ) |
    # Add to publicCognitoLogoutUrls if not present
    .publicCognitoLogoutUrls = (
      if .publicCognitoLogoutUrls then
        (.publicCognitoLogoutUrls + [$cf, $cf_logout] | unique)
      else
        [$cf, $cf_logout]
      end
    )
  ')

  aws ssm put-parameter --region "${REGION}" \
    --name "${PUBLIC_IDENTITY_CONFIG_PATH}" \
    --type String \
    --value "${UPDATED_PUBLIC_CONFIG}" \
    --overwrite >/dev/null

  echo "  Added https://${PUBLIC_CLOUDFRONT} to public callback/logout URLs."
fi
echo ""

# =============================================================================
# DONE
# =============================================================================
echo "========================================================"
echo "  CONFIG SEEDING COMPLETE"
echo "========================================================"
echo ""
echo "DynamoDB config entries created in table:"
echo "  ${TABLE_NAME}"
echo ""
echo "SSM configs updated with sandbox CloudFront URLs."
echo ""
echo "NEXT STEPS:"
echo ""
echo "  1. Redeploy identity stacks to update Cognito callback URLs:"
echo "     cd reserve-rec-api && nix-shell --run \"SANDBOX_NAME=${SANDBOX_NAME} yarn sandbox:deploy\""
echo ""
echo "  2. Publish admin frontend:"
echo "     cd reserve-rec-admin && SANDBOX_NAME=${SANDBOX_NAME} yarn sandbox:publish"
echo ""
echo "  3. Publish public frontend:"
echo "     cd reserve-rec-public && SANDBOX_NAME=${SANDBOX_NAME} yarn sandbox:publish"
echo ""
