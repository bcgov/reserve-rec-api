#!/usr/bin/env bash
set -e

# Sandbox Teardown Script for reserve-rec-api
# Destroys CDK stacks and cleans up SSM configs and secrets

SANDBOX_NAME="${1:?Usage: ./sandbox-teardown.sh <sandbox-name> [base-env]}"
BASE_ENV="${2:-dev}"
DEPLOYMENT_NAME="${BASE_ENV}-${SANDBOX_NAME}"
APP_NAME="reserveRecApi"
REGION="ca-central-1"

echo "========================================="
echo "TEARING DOWN SANDBOX: ${DEPLOYMENT_NAME}"
echo "========================================="
echo ""
echo "This will:"
echo "  1. Destroy all CDK stacks"
echo "  2. Delete all SSM parameters"
echo "  3. Delete all Secrets Manager secrets"
echo ""
read -p "Are you sure? Type 'yes' to continue: " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "Step 0: Preparing Cognito User Pools for deletion..."
echo "------------------------------------------------------"

# Get user pool IDs from SSM (if they exist)
ADMIN_POOL=$(aws ssm get-parameter --region ${REGION} \
  --name "/${APP_NAME}/${DEPLOYMENT_NAME}/adminIdentityStack/adminUserPoolId" \
  --query 'Parameter.Value' --output text 2>/dev/null || echo "")

PUBLIC_POOL=$(aws ssm get-parameter --region ${REGION} \
  --name "/${APP_NAME}/${DEPLOYMENT_NAME}/publicIdentityStack/publicUserPoolId" \
  --query 'Parameter.Value' --output text 2>/dev/null || echo "")

# Handle Admin User Pool
if [ -n "$ADMIN_POOL" ]; then
  echo "  Processing admin user pool: $ADMIN_POOL"
  
  # Get and delete domain if it exists
  ADMIN_DOMAIN=$(aws cognito-idp describe-user-pool --region ${REGION} \
    --user-pool-id "$ADMIN_POOL" \
    --query 'UserPool.Domain' --output text 2>/dev/null || echo "")
  
  if [ -n "$ADMIN_DOMAIN" ] && [ "$ADMIN_DOMAIN" != "None" ]; then
    echo "    Deleting domain: $ADMIN_DOMAIN"
    aws cognito-idp delete-user-pool-domain --region ${REGION} \
      --domain "$ADMIN_DOMAIN" \
      --user-pool-id "$ADMIN_POOL" 2>/dev/null || true
  fi
  
  # Disable deletion protection
  echo "    Disabling deletion protection"
  aws cognito-idp update-user-pool --region ${REGION} \
    --user-pool-id "$ADMIN_POOL" \
    --deletion-protection INACTIVE 2>/dev/null || true
fi

# Handle Public User Pool
if [ -n "$PUBLIC_POOL" ]; then
  echo "  Processing public user pool: $PUBLIC_POOL"
  
  # Get and delete domain if it exists
  PUBLIC_DOMAIN=$(aws cognito-idp describe-user-pool --region ${REGION} \
    --user-pool-id "$PUBLIC_POOL" \
    --query 'UserPool.Domain' --output text 2>/dev/null || echo "")
  
  if [ -n "$PUBLIC_DOMAIN" ] && [ "$PUBLIC_DOMAIN" != "None" ]; then
    echo "    Deleting domain: $PUBLIC_DOMAIN"
    aws cognito-idp delete-user-pool-domain --region ${REGION} \
      --domain "$PUBLIC_DOMAIN" \
      --user-pool-id "$PUBLIC_POOL" 2>/dev/null || true
  fi
  
  # Disable deletion protection
  echo "    Disabling deletion protection"
  aws cognito-idp update-user-pool --region ${REGION} \
    --user-pool-id "$PUBLIC_POOL" \
    --deletion-protection INACTIVE 2>/dev/null || true
fi

if [ -z "$ADMIN_POOL" ] && [ -z "$PUBLIC_POOL" ]; then
  echo "  No user pools found (may have been deleted already)"
else
  echo "  ✓ User pools prepared for deletion"
fi

echo ""
echo "Step 1: Destroying CDK stacks..."
echo "---------------------------------"
yarn cdk destroy -c @context=${BASE_ENV} -c sandboxName=${SANDBOX_NAME} --all --force

echo ""
echo "Step 2: Deleting SSM parameters..."
echo "-----------------------------------"
PARAMS=$(aws ssm get-parameters-by-path --region ${REGION} \
  --path "/${APP_NAME}/${DEPLOYMENT_NAME}" \
  --recursive --query 'Parameters[].Name' --output text 2>/dev/null || echo "")

if [ -n "${PARAMS}" ]; then
  echo "${PARAMS}" | tr '\t' '\n' | while read param; do
    if [ -n "$param" ]; then
      echo "  Deleting: $param"
      aws ssm delete-parameter --region ${REGION} --name "$param" 2>/dev/null || true
    fi
  done
  echo "  ✓ SSM parameters deleted"
else
  echo "  No SSM parameters found (may have been deleted already)"
fi

echo ""
echo "Step 3: Deleting Secrets Manager secrets..."
echo "---------------------------------------------"
SECRETS=$(aws secretsmanager list-secrets --region ${REGION} \
  --filter Key=name,Values="/${APP_NAME}/${DEPLOYMENT_NAME}" \
  --query 'SecretList[].Name' --output text 2>/dev/null || echo "")

if [ -n "${SECRETS}" ]; then
  echo "${SECRETS}" | tr '\t' '\n' | while read secret; do
    if [ -n "$secret" ]; then
      echo "  Deleting: $secret"
      aws secretsmanager delete-secret --region ${REGION} \
        --secret-id "$secret" --force-delete-without-recovery 2>/dev/null || true
    fi
  done
  echo "  ✓ Secrets deleted"
else
  echo "  No secrets found (may have been deleted already)"
fi

echo ""
echo "========================================="
echo "Sandbox ${SANDBOX_NAME} fully destroyed!"
echo "========================================="
