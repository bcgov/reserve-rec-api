# Email Dispatch System

A modular email dispatch system for BC Parks' reservation receipts using AWS SES, SQS, and Handlebars templates.

## Overview

This system provides:
- **Asynchronous email processing** via SQS queues
- **Region-specific templating** with Handlebars
- **Multi-language support** (English/French)
- **Template versioning** and S3 storage
- **Scalable architecture** with retry/DLQ handling
- **Comprehensive logging** and error handling

## Architecture

```
Payment Complete → SQS Message → Lambda → Template Engine → SES → Email Sent
                                    ↓
                              S3 Templates
```

### Components

1. **SQS Queue**: Handles email dispatch messages with DLQ for failed processing
2. **Lambda Function**: Processes messages, loads templates, and sends emails
3. **Template Engine**: Renders Handlebars templates with regional data
4. **S3 Storage**: Stores versioned email templates
5. **SES Integration**: Sends formatted emails to customers

## Quick Start

### 1. Deploy Infrastructure

The email dispatch system is automatically deployed as part of the main CDK stack:

```bash
npm run build
cdk deploy
```

### 2. Environment Variables

Required environment variables:
```bash
EMAIL_QUEUE_URL=https://sqs.ca-central-1.amazonaws.com/.../ReserveRecEmailQueue
TEMPLATE_BUCKET_NAME=reserve-rec-email-templates-{env}
SES_FROM_EMAIL=noreply@bcparks.ca
SES_REGION=ca-central-1
```

### 3. Send a Receipt Email

```javascript
const { sendReceiptEmail, getRegionBranding } = require('./lib/handlers/emailDispatch/utils');

// After successful payment processing
await sendReceiptEmail({
  bookingData: {
    bookingId: 'BK123456',
    orderNumber: 'WL789012',
    orderDate: '2024-03-15T10:30:00Z',
    startDate: '2024-06-15',
    status: 'confirmed'
  },
  customerData: {
    firstName: 'John',
    lastName: 'Doe',
    email: 'customer@example.com'
  },
  paymentData: {
    totalAmount: 5000, // $50.00 in cents
    currency: 'CAD',
    transactionId: 'TXN123456'
  },
  locationData: {
    parkName: 'Kokanee Creek Provincial Park',
    region: 'kootenay'
  },
  brandingData: getRegionBranding({ region: 'kootenay' }),
  locale: 'en'
});
```

## Template System

### Template Structure

```
lib/handlers/emailDispatch/templates/
├── en/
│   ├── receipt_bcparks_kootenay.html
│   ├── receipt_bcparks_kootenay.txt
│   ├── receipt_bcparks_vancouverisland.html
│   └── receipt_bcparks_vancouverisland.txt
└── fr/
    ├── receipt_bcparks_kootenay.html
    ├── receipt_bcparks_kootenay.txt
    └── ...
```

### Template Naming Convention

Format: `{messageType}_{brand}_{region}.{extension}`

Examples:
- `receipt_bcparks_kootenay.html`
- `confirmation_bcparks_vancouverisland.txt`
- `cancellation_bcparks_mainland.html`

### Available Regions

- `kootenay` - Kootenay Rockies region
- `vancouverisland` - Vancouver Island region  
- `mainland` - Mainland BC region
- `northern` - Northern BC region
- `default` - Default BC Parks branding

### Template Variables

Templates have access to these data objects:

#### Booking Data
```handlebars
{{booking.bookingId}}
{{booking.orderNumber}}
{{formatDate booking.orderDate 'long'}}
{{booking.status}}
```

#### Location Data
```handlebars
{{location.parkName}}
{{location.facilityName}}
{{location.region}}
```

#### Payment Data
```handlebars
{{currency payment.totalAmount payment.currency}}
{{payment.transactionId}}
{{#each payment.itemBreakdown}}
  {{this.description}}: {{currency this.amount}}
{{/each}}
```

#### Customer Data
```handlebars
{{customer.firstName}} {{customer.lastName}}
{{customer.email}}
{{customer.phone}}
```

#### Branding Data
```handlebars
{{branding.primaryColor}}
{{branding.logoUrl}}
{{branding.contactEmail}}
```

### Handlebars Helpers

Custom helpers available in templates:

- `{{currency amount}}` - Format currency (e.g., $50.00)
- `{{formatDate date 'long'}}` - Format dates
- `{{pluralize count 'item' 'items'}}` - Pluralization
- `{{t 'translation.key'}}` - Localization
- `{{#if_eq a b}}...{{/if_eq}}` - Conditional equality

### Creating New Templates

1. **Create template files**:
   ```bash
   # HTML version
   touch lib/handlers/emailDispatch/templates/en/newtype_bcparks_region.html
   
   # Text version  
   touch lib/handlers/emailDispatch/templates/en/newtype_bcparks_region.txt
   ```

2. **Use existing templates as reference**
3. **Test locally** with the test suite
4. **Deploy via CI/CD** or manual sync script

## Regional Branding

Each BC Parks region has specific branding configuration:

### Kootenay Region
- **Primary Color**: `#2c5530` (Forest Green)
- **Theme**: Mountain wilderness, crystal-clear lakes
- **Contact**: kootenay.info@gov.bc.ca

### Vancouver Island Region  
- **Primary Color**: `#1a4480` (Ocean Blue)
- **Theme**: Coastal rainforests, rugged coastlines
- **Contact**: vancouverisland.info@gov.bc.ca

### Mainland Region
- **Primary Color**: `#8b4513` (Saddle Brown)
- **Theme**: Urban parks, mountain access
- **Contact**: mainland.info@gov.bc.ca

### Northern Region
- **Primary Color**: `#2f4f4f` (Dark Slate Gray)
- **Theme**: Wilderness, aurora, remote lakes
- **Contact**: northern.info@gov.bc.ca

## Message Types

### Receipt Emails
Sent after successful payment processing:
- Order confirmation details
- Payment breakdown
- Booking information
- Regional park information

### Confirmation Emails  
Sent when booking is confirmed:
- Check-in instructions
- Park regulations
- Contact information

### Cancellation Emails
Sent when booking is cancelled:
- Cancellation confirmation
- Refund information
- Rebooking suggestions

## Deployment & CI/CD

### Manual Template Sync

```bash
# Sync to development
./scripts/sync-email-templates.sh dev

# Sync to production
./scripts/sync-email-templates.sh prod
```

### Automated Deployment

Templates are automatically deployed via GitHub Actions:

- **Development**: On push to `develop` branch
- **Production**: On push to `main` branch  
- **Manual**: Via workflow dispatch

### Template Versioning

- S3 versioning enabled for rollback capability
- Automatic backups before production deployments
- Git tags created for production releases

## Testing

### Unit Tests

```bash
npm test -- emailDispatch.test.js
```

### Template Validation

```bash
# Validate syntax
./scripts/sync-email-templates.sh dev --validate-only

# Test specific template
node -e "
const Handlebars = require('handlebars');
const fs = require('fs');
const template = Handlebars.compile(fs.readFileSync('path/to/template.html', 'utf8'));
console.log(template({ /* test data */ }));
"
```

### Integration Testing

```bash
# Test complete email flow
npm test -- --grep "integration"
```

## Monitoring & Logging

### CloudWatch Metrics

- Email send success/failure rates
- Queue depth and processing times
- Template loading performance
- SES bounce/complaint rates

### Log Structure

```json
{
  "timestamp": "2024-03-15T10:30:00Z",
  "level": "INFO",
  "message": "Email sent successfully",
  "messageId": "ses-message-id",
  "templateName": "receipt_bcparks_kootenay",
  "recipient": "customer@example.com",
  "bookingId": "BK123456"
}
```

### Error Handling

- Failed messages sent to Dead Letter Queue
- Automatic retry with exponential backoff
- Detailed error logging for debugging
- Email notifications for critical failures

## Security

### SES Configuration

- DKIM signing enabled
- SPF records configured
- Domain verification required
- Rate limiting applied

### Data Protection

- PII data encrypted in transit
- Temporary template caching only
- Secure S3 bucket policies
- IAM roles with minimal permissions

### Compliance

- PIPEDA compliance for Canadian privacy laws
- Email unsubscribe handling
- Data retention policies
- Audit logging

## Future Enhancements

### Planned Features

1. **DKIM Signing**: Enhanced email authentication
2. **Batch Sending**: Improved performance for high volumes
3. **A/B Testing**: Template effectiveness testing
4. **Advanced Analytics**: Email engagement metrics
5. **Template Editor**: Web-based template management
6. **Multi-region SES**: Geographic email routing

### Roadmap

- **Q2 2024**: DKIM implementation
- **Q3 2024**: Batch processing optimization  
- **Q4 2024**: Analytics dashboard
- **Q1 2025**: Template management UI

## Troubleshooting

### Common Issues

**Templates not loading**:
- Check S3 bucket permissions
- Verify template file names match convention
- Ensure templates are synced to correct environment

**Emails not sending**:
- Verify SES sender identity
- Check SES sending limits
- Review CloudWatch logs for errors

**Template rendering errors**:
- Validate Handlebars syntax
- Check data object structure
- Test with sample data

### Debug Commands

```bash
# Check SQS queue status
aws sqs get-queue-attributes --queue-url $EMAIL_QUEUE_URL

# List S3 templates
aws s3 ls s3://reserve-rec-email-templates-prod/ --recursive

# Test SES sending
aws ses send-email --source noreply@bcparks.ca --destination ToAddresses=test@example.com --message Subject={Data="Test"},Body={Text={Data="Test message"}}
```

## Support

For questions or issues:
- **Technical**: Create GitHub issue
- **Templates**: Contact UX/Design team
- **Infrastructure**: Contact DevOps team
- **Email deliverability**: Contact SES administrator

## License

Apache 2.0 - See LICENSE file for details.