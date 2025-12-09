# Email Template Management

## Overview

The email dispatch system uses Handlebars templates stored in S3 (or locally for development). Templates support both HTML and plain text formats with locale support (en/fr).

## Template Structure

Templates are organized by locale:

```
S3 Bucket: reserve-rec-email-templates-{env}
├── en/
│   ├── receipt_bcparks_kootenay.html
│   ├── receipt_bcparks_kootenay.txt
│   ├── booking_confirmation.html
│   └── booking_confirmation.txt
└── fr/
    ├── receipt_bcparks_kootenay.html
    ├── receipt_bcparks_kootenay.txt
    ├── booking_confirmation.html
    └── booking_confirmation.txt
```

## Template Format

Templates use Handlebars syntax with custom helpers:

### Available Handlebars Helpers

1. **`{{currency amount}}`** - Formats amounts (in cents) as CAD currency
   - Example: `{{currency 4500}}` → "$45.00"

2. **`{{formatDate date format}}`** - Formats dates
   - Formats: `short`, `long`, `time`
   - Example: `{{formatDate arrivalDate 'long'}}` → "Monday, July 15, 2024"

3. **`{{#if_eq a b}}`** - Conditional equality check
   - Example: `{{#if_eq status 'confirmed'}}Confirmed{{/if_eq}}`

4. **`{{pluralize count singular plural}}`** - Pluralization
   - Example: `{{pluralize nights 'night' 'nights'}}`

5. **`{{t key}}`** - Translation lookup
   - Example: `{{t 'booking.confirmation'}}`

### Example Template Data

```json
{
  "bookingId": "RES123456",
  "customerName": "John Doe",
  "customerEmail": "john.doe@example.com",
  "facilityName": "Kootenay National Park",
  "arrivalDate": "2024-07-15",
  "departureDate": "2024-07-18",
  "nights": 3,
  "totalAmount": 15000,
  "items": [
    {
      "description": "Campsite Booking",
      "quantity": 3,
      "unitPrice": 5000,
      "total": 15000
    }
  ]
}
```

## Uploading Templates to S3

### Method 1: AWS CLI (Recommended)

Upload a single template:

```bash
# Upload HTML template
aws s3 cp lib/handlers/emailDispatch/templates/en/receipt_bcparks_kootenay.html \
  s3://reserve-rec-email-templates-dev/en/receipt_bcparks_kootenay.html \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1

# Upload text template
aws s3 cp lib/handlers/emailDispatch/templates/en/receipt_bcparks_kootenay.txt \
  s3://reserve-rec-email-templates-dev/en/receipt_bcparks_kootenay.txt \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

Upload all templates:

```bash
# Upload all English templates
aws s3 sync lib/handlers/emailDispatch/templates/en/ \
  s3://reserve-rec-email-templates-dev/en/ \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1

# Upload all French templates (when available)
aws s3 sync lib/handlers/emailDispatch/templates/fr/ \
  s3://reserve-rec-email-templates-dev/fr/ \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

### Method 2: AWS Console

1. Navigate to S3 in AWS Console (account: 623829546818)
2. Open bucket `reserve-rec-email-templates-dev`
3. Create folder structure: `en/` and `fr/`
4. Upload `.html` and `.txt` files to appropriate locale folders
5. Ensure files are readable by the Lambda execution role

### Method 3: Automated Script (Future)

Create a deployment script for template management:

```bash
# Example: scripts/deploy-email-templates.sh
#!/bin/bash
ENVIRONMENT=${1:-dev}
PROFILE="623829546818_BCGOV_LZA_Admin"
BUCKET="reserve-rec-email-templates-${ENVIRONMENT}"

echo "Deploying email templates to ${BUCKET}..."
aws s3 sync lib/handlers/emailDispatch/templates/ s3://${BUCKET}/ \
  --profile ${PROFILE} \
  --region ca-central-1 \
  --exclude ".*"

echo "Templates deployed successfully"
```

## Testing Email Templates Locally

The template engine falls back to local filesystem when `TEMPLATE_BUCKET_NAME` is not set:

```javascript
// Local development - uses lib/handlers/emailDispatch/templates/
const templateEngine = new TemplateEngine({
  locale: 'en'
});

// Production - uses S3
const templateEngine = new TemplateEngine({
  templateBucket: 'reserve-rec-email-templates-dev',
  locale: 'en'
});
```

## Template Versioning

The S3 bucket has versioning enabled. To view previous versions:

```bash
aws s3api list-object-versions \
  --bucket reserve-rec-email-templates-dev \
  --prefix en/receipt_bcparks_kootenay.html \
  --profile 623829546818_BCGOV_LZA_Admin
```

To rollback to a previous version, copy the version ID:

```bash
aws s3api get-object \
  --bucket reserve-rec-email-templates-dev \
  --key en/receipt_bcparks_kootenay.html \
  --version-id <VERSION_ID> \
  receipt_backup.html \
  --profile 623829546818_BCGOV_LZA_Admin
```

## Template Cache

Templates are cached in Lambda memory:
- Cache key: `{templateName}_{locale}`
- Cache cleared on Lambda cold start
- To force cache clear: Update Lambda environment variable or redeploy

## Sending Test Emails

### 1. Create Test Message

```json
{
  "recipientEmail": "test@example.com",
  "recipientName": "Test User",
  "subject": "Your Booking Confirmation",
  "templateName": "receipt_bcparks_kootenay",
  "locale": "en",
  "templateData": {
    "bookingId": "TEST123",
    "customerName": "Test User",
    "facilityName": "Kootenay National Park",
    "arrivalDate": "2024-08-01",
    "departureDate": "2024-08-03",
    "nights": 2,
    "totalAmount": 10000
  },
  "metadata": {
    "messageType": "booking_confirmation",
    "bookingId": "TEST123"
  }
}
```

### 2. Send to SQS Queue

```bash
aws sqs send-message \
  --queue-url https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev \
  --message-body file://test-message.json \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

### 3. Check CloudWatch Logs

```bash
aws logs tail /aws/lambda/ReserveRecApi-Dev-EmailDispatch \
  --follow \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

## Troubleshooting

### Template Not Found
- Verify file exists in S3: `aws s3 ls s3://reserve-rec-email-templates-dev/en/`
- Check Lambda has S3 read permissions
- Verify correct template name in message payload

### Email Not Sending
- Check SES sandbox status (must verify recipient email in sandbox mode)
- Verify sender email `noreply@bcparks.ca` is authorized
- Check Lambda CloudWatch logs for errors

### Rendering Issues
- Test Handlebars syntax locally first
- Ensure template data matches expected structure
- Check for missing helpers or undefined variables

## Next Steps

1. Upload existing templates to S3 bucket
2. Add French translations for all templates
3. Create additional templates for:
   - Booking confirmation
   - Booking cancellation
   - Payment receipt
   - Refund confirmation
4. Request SES production access to send to all customers
5. Set up CloudWatch alarms for DLQ messages
