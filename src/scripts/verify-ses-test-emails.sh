#!/bin/bash

###############################################################################
# SES Test Email Verification Script
# 
# Purpose: Verify email addresses in SES for testing in sandbox mode
# Usage: ./verify-ses-test-emails.sh [profile] [region]
#
# Examples:
#   ./verify-ses-test-emails.sh 623829546818_BCGOV_LZA_Admin ca-central-1
#   ./verify-ses-test-emails.sh test-profile us-west-2
#
# Email List File: ses-test-emails.txt (in repository root)
# 
# File Format:
#   - One email address per line
#   - Lines starting with # are comments (ignored)
#   - Blank lines are ignored
#
# Script is idempotent: safe to run multiple times
###############################################################################

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEFAULT_PROFILE="623829546818_BCGOV_LZA_Admin"
DEFAULT_REGION="ca-central-1"

# Get parameters or use defaults
AWS_PROFILE=${1:-$DEFAULT_PROFILE}
AWS_REGION=${2:-$DEFAULT_REGION}
EMAIL_LIST_FILE="ses-test-emails.txt"

# Get script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
EMAIL_LIST_PATH="$PROJECT_ROOT/$EMAIL_LIST_FILE"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}SES Test Email Verification${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "AWS Profile: ${YELLOW}$AWS_PROFILE${NC}"
echo -e "AWS Region:  ${YELLOW}$AWS_REGION${NC}"
echo -e "Email List:  ${YELLOW}$EMAIL_LIST_PATH${NC}"
echo ""

# Check if email list file exists
if [ ! -f "$EMAIL_LIST_PATH" ]; then
    echo -e "${RED}ERROR: Email list file not found: $EMAIL_LIST_PATH${NC}"
    echo ""
    echo "Please create a file named '$EMAIL_LIST_FILE' in the project root with email addresses (one per line)."
    echo ""
    echo "Example content:"
    echo "  # Test users for SES sandbox"
    echo "  john.doe@gov.bc.ca"
    echo "  jane.smith@gov.bc.ca"
    echo "  test.user@gov.bc.ca"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}ERROR: AWS CLI is not installed${NC}"
    exit 1
fi

# Verify AWS credentials
echo -e "${BLUE}Verifying AWS credentials...${NC}"
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION" &> /dev/null; then
    echo -e "${RED}ERROR: Failed to authenticate with AWS profile '$AWS_PROFILE'${NC}"
    exit 1
fi
echo -e "${GREEN}✓ AWS credentials verified${NC}"
echo ""

# Function to check if email is already verified
is_email_verified() {
    local email=$1
    local result=$(aws sesv2 get-email-identity \
        --email-identity "$email" \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --query 'VerifiedForSendingStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$result" = "True" ]; then
        return 0  # Already verified
    else
        return 1  # Not verified
    fi
}

# Function to verify email
verify_email() {
    local email=$1
    aws sesv2 create-email-identity \
        --email-identity "$email" \
        --profile "$AWS_PROFILE" \
        --region "$AWS_REGION" \
        --output json &> /dev/null
    return $?
}

# Counters
total_count=0
skipped_count=0
verified_count=0
new_count=0
error_count=0

echo -e "${BLUE}Processing email addresses...${NC}"
echo ""

# Read and process email list
while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines and comments
    if [[ -z "$line" ]] || [[ "$line" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    
    # Trim whitespace
    email=$(echo "$line" | xargs)
    
    # Skip if still empty after trimming
    if [[ -z "$email" ]]; then
        continue
    fi
    
    # Validate email format (basic check)
    if [[ ! "$email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        echo -e "${YELLOW}⚠ Skipping invalid email format: $email${NC}"
        ((error_count++))
        continue
    fi
    
    ((total_count++))
    
    # Check if already verified
    if is_email_verified "$email"; then
        echo -e "${GREEN}✓ Already verified: $email${NC}"
        ((verified_count++))
    else
        # Attempt to verify
        if verify_email "$email"; then
            echo -e "${GREEN}+ Verification request sent: $email${NC}"
            ((new_count++))
        else
            echo -e "${RED}✗ Failed to verify: $email${NC}"
            ((error_count++))
        fi
    fi
    
done < "$EMAIL_LIST_PATH"

# Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Summary${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "Total emails processed:       ${YELLOW}$total_count${NC}"
echo -e "Already verified:             ${GREEN}$verified_count${NC}"
echo -e "New verification requests:    ${GREEN}$new_count${NC}"
if [ $error_count -gt 0 ]; then
    echo -e "Errors:                       ${RED}$error_count${NC}"
fi
echo ""

if [ $new_count -gt 0 ]; then
    echo -e "${YELLOW}⚠ Action Required:${NC}"
    echo -e "  $new_count verification email(s) have been sent."
    echo -e "  Recipients must click the verification link in their email."
    echo -e "  Verification links expire after 24 hours."
    echo ""
fi

if [ $error_count -gt 0 ]; then
    echo -e "${RED}Some errors occurred during processing.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Script completed successfully${NC}"
exit 0
