#!/bin/bash

# Email Template Sync Script for CI/CD
# This script syncs Handlebars email templates to S3 for the email dispatch system

set -e

# Configuration
TEMPLATE_SOURCE_DIR="lib/handlers/emailDispatch/templates"
ENVIRONMENT=${1:-dev}
S3_BUCKET="reserve-rec-email-templates-${ENVIRONMENT}"
AWS_REGION=${AWS_REGION:-ca-central-1}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if template directory exists
check_template_directory() {
    log_info "Checking template directory: ${TEMPLATE_SOURCE_DIR}"
    
    if [ ! -d "${TEMPLATE_SOURCE_DIR}" ]; then
        log_error "Template directory not found: ${TEMPLATE_SOURCE_DIR}"
        exit 1
    fi
    
    local template_count=$(find "${TEMPLATE_SOURCE_DIR}" -name "*.html" -o -name "*.txt" | wc -l)
    log_info "Found ${template_count} template files"
    
    if [ ${template_count} -eq 0 ]; then
        log_warn "No template files found in ${TEMPLATE_SOURCE_DIR}"
    fi
}

# Check if S3 bucket exists
check_s3_bucket() {
    log_info "Checking S3 bucket: ${S3_BUCKET}"
    
    if ! aws s3api head-bucket --bucket "${S3_BUCKET}" --region "${AWS_REGION}" 2>/dev/null; then
        log_error "S3 bucket not found or not accessible: ${S3_BUCKET}"
        log_info "Please ensure the bucket exists and you have proper permissions"
        exit 1
    fi
    
    log_info "S3 bucket exists and is accessible"
}

# Validate template files
validate_templates() {
    log_info "Validating template files..."
    
    local errors=0
    
    # Check for required template files
    local required_templates=(
        "en/receipt_bcparks_kootenay.html"
        "en/receipt_bcparks_kootenay.txt"
    )
    
    for template in "${required_templates[@]}"; do
        local template_path="${TEMPLATE_SOURCE_DIR}/${template}"
        if [ ! -f "${template_path}" ]; then
            log_error "Required template missing: ${template}"
            errors=$((errors + 1))
        else
            log_info "✓ Found required template: ${template}"
        fi
    done
    
    # Validate HTML templates for basic structure
    find "${TEMPLATE_SOURCE_DIR}" -name "*.html" | while read -r html_file; do
        log_info "Validating HTML template: ${html_file}"
        
        # Check for basic HTML structure
        if ! grep -q "<html" "${html_file}"; then
            log_warn "HTML template missing <html> tag: ${html_file}"
        fi
        
        # Check for Handlebars syntax
        if ! grep -q "{{" "${html_file}"; then
            log_warn "HTML template has no Handlebars variables: ${html_file}"
        fi
        
        # Check for region-specific content
        if echo "${html_file}" | grep -q "kootenay" && ! grep -q -i "kootenay" "${html_file}"; then
            log_warn "Kootenay template missing region-specific content: ${html_file}"
        fi
    done
    
    if [ ${errors} -gt 0 ]; then
        log_error "Template validation failed with ${errors} errors"
        exit 1
    fi
    
    log_info "Template validation completed successfully"
}

# Sync templates to S3
sync_templates() {
    log_info "Syncing templates to S3..."
    
    # Sync templates with metadata
    aws s3 sync "${TEMPLATE_SOURCE_DIR}" "s3://${S3_BUCKET}" \
        --region "${AWS_REGION}" \
        --delete \
        --metadata "Environment=${ENVIRONMENT},SyncTime=$(date -u +%Y-%m-%dT%H:%M:%SZ),Version=$(git rev-parse HEAD 2>/dev/null || echo 'unknown')" \
        --exclude "*.DS_Store" \
        --exclude "*.git*" \
        --exclude "node_modules/*" \
        --exclude "*.tmp"
    
    if [ $? -eq 0 ]; then
        log_info "Templates synced successfully to s3://${S3_BUCKET}"
    else
        log_error "Failed to sync templates to S3"
        exit 1
    fi
}

# Verify sync by listing S3 contents
verify_sync() {
    log_info "Verifying sync..."
    
    log_info "S3 bucket contents:"
    aws s3 ls "s3://${S3_BUCKET}" --recursive --region "${AWS_REGION}"
    
    # Check that key templates exist in S3
    local key_templates=(
        "en/receipt_bcparks_kootenay.html"
        "en/receipt_bcparks_kootenay.txt"
    )
    
    for template in "${key_templates[@]}"; do
        if aws s3api head-object --bucket "${S3_BUCKET}" --key "${template}" --region "${AWS_REGION}" >/dev/null 2>&1; then
            log_info "✓ Verified template in S3: ${template}"
        else
            log_error "✗ Template not found in S3: ${template}"
        fi
    done
}

# Create backup of current templates
create_backup() {
    local backup_prefix="backups/$(date +%Y-%m-%d_%H-%M-%S)"
    
    log_info "Creating backup of current templates..."
    
    # Copy current S3 templates to backup location
    aws s3 cp "s3://${S3_BUCKET}/" "s3://${S3_BUCKET}/${backup_prefix}/" \
        --recursive \
        --region "${AWS_REGION}" \
        --quiet 2>/dev/null || log_warn "No existing templates to backup"
    
    log_info "Backup created at s3://${S3_BUCKET}/${backup_prefix}/"
}

# Test template rendering (basic syntax check)
test_templates() {
    log_info "Testing template syntax..."
    
    # This is a basic check - in a full CI/CD pipeline, you'd run actual template rendering tests
    find "${TEMPLATE_SOURCE_DIR}" -name "*.html" -o -name "*.txt" | while read -r template_file; do
        # Check for unclosed Handlebars expressions
        if grep -n "{{[^}]*$" "${template_file}"; then
            log_error "Unclosed Handlebars expression in ${template_file}"
            exit 1
        fi
        
        # Check for unmatched Handlebars blocks
        local open_blocks=$(grep -c "{{#" "${template_file}" || echo 0)
        local close_blocks=$(grep -c "{{/" "${template_file}" || echo 0)
        
        if [ ${open_blocks} -ne ${close_blocks} ]; then
            log_error "Unmatched Handlebars blocks in ${template_file} (${open_blocks} open, ${close_blocks} close)"
            exit 1
        fi
    done
    
    log_info "Template syntax tests passed"
}

# Main execution
main() {
    log_info "Starting email template sync for environment: ${ENVIRONMENT}"
    log_info "Source: ${TEMPLATE_SOURCE_DIR}"
    log_info "Target: s3://${S3_BUCKET}"
    
    # Validation steps
    check_template_directory
    check_s3_bucket
    validate_templates
    test_templates
    
    # Backup current templates
    create_backup
    
    # Sync new templates
    sync_templates
    
    # Verify the sync
    verify_sync
    
    log_info "Email template sync completed successfully!"
    log_info "Templates are now available for the email dispatch system"
}

# Help function
show_help() {
    echo "Email Template Sync Script"
    echo ""
    echo "Usage: $0 [environment]"
    echo ""
    echo "Arguments:"
    echo "  environment    Target environment (dev, test, prod) [default: dev]"
    echo ""
    echo "Environment Variables:"
    echo "  AWS_REGION     AWS region [default: ca-central-1]"
    echo ""
    echo "Examples:"
    echo "  $0 dev         # Sync to development environment"
    echo "  $0 prod        # Sync to production environment"
    echo ""
    echo "Prerequisites:"
    echo "  - AWS CLI configured with appropriate permissions"
    echo "  - S3 bucket exists: reserve-rec-email-templates-{env}"
    echo "  - Template files exist in: lib/handlers/emailDispatch/templates"
}

# Check for help flag
if [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
    show_help
    exit 0
fi

# Validate environment argument
if [ -n "$1" ] && [[ ! "$1" =~ ^(dev|test|staging|prod)$ ]]; then
    log_error "Invalid environment: $1"
    log_info "Valid environments: dev, test, staging, prod"
    exit 1
fi

# Run main function
main