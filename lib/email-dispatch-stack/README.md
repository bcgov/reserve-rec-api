# Email Dispatch Stack

This stack provides the infrastructure for the Reserve Recreation API email dispatch system, which handles sending transactional emails (receipts, confirmations, cancellations) to customers via AWS SES.

## Overview

The Email Dispatch Stack creates and manages:

- **SQS Queue**: Main queue for email dispatch messages
- **SQS Dead Letter Queue**: Captures failed email processing attempts
- **S3 Bucket**: Stores email templates (HTML and text)
- **Lambda Function**: Processes email messages and sends via AWS SES
- **IAM Permissions**: Grants necessary permissions for SES, S3, SQS, and CloudWatch Logs

## Architecture

```
API Handler (e.g., Worldline Notification)
    |
    v
[SQS Queue] --> [Lambda Function] --> [AWS SES] --> Customer Email
    |                   |
    v (on failure)      v (reads templates)
[Dead Letter Queue]  [S3 Bucket]
```

## Components

### 1. Email Dispatch Queue
- **Purpose**: Receives email dispatch messages from other Lambda functions
- **Configuration**:
  - Visibility timeout: 5 minutes (Lambda timeout + buffer)
  - Message retention: 14 days
  - Max receive count: 3 (before moving to DLQ)
  - Encryption: KMS encrypted

### 2. Email Dispatch Dead Letter Queue (DLQ)
- **Purpose**: Captures messages that fail processing after 3 attempts
- **Configuration**:
  - Message retention: 14 days
  - Encryption: KMS encrypted

### 3. Email Templates S3 Bucket
- **Purpose**: Stores Handlebars email templates in HTML and text formats
- **Configuration**:
  - Versioning: Enabled (allows template rollback)
  - Public access: Blocked
  - Encryption: KMS encrypted
  - Removal policy: Retain (prevents accidental deletion)

### 4. Email Dispatch Lambda Function
- **Purpose**: Processes SQS messages and sends emails via AWS SES
- **Configuration**:
  - Runtime: Node.js 20.x
  - Timeout: 3 minutes
  - Memory: 512 MB
  - Batch size: 1 (processes one email at a time)
  - Trigger: SQS event source

### 5. IAM Permissions
The Lambda function is granted:
- SQS: Consume messages from queue and DLQ
- S3: Read email templates from bucket
- SES: Send emails, get send quota and statistics
- CloudWatch Logs: Create log groups/streams and write logs

## Environment Variables

The Lambda function receives these environment variables:
- `LOG_LEVEL`: Logging level (info, debug, warn, error)
- `EMAIL_QUEUE_URL`: URL of the email dispatch SQS queue
- `TEMPLATE_BUCKET_NAME`: Name of the S3 bucket containing templates
- `SES_FROM_EMAIL`: Email address to use as sender (default: noreply@bcparks.ca)
- `SES_REGION`: AWS region for SES (default: ca-central-1)
- `AWS_REGION`: AWS region for other services

## Template Structure

Email templates are stored in S3 with this structure:
```
/{locale}/{template_name}.html
/{locale}/{template_name}.txt
```

Example:
- `/en/receipt_bcparks_kootenay.html`
- `/en/receipt_bcparks_kootenay.txt`

Templates use Handlebars syntax and can include:
- Region-specific branding
- Booking details
- Customer information
- Payment information
- Location details

## Email Message Schema

Messages sent to the SQS queue must follow this schema:
```json
{
  "messageType": "receipt|confirmation|cancellation",
  "templateName": "receipt_bcparks_kootenay",
  "recipientEmail": "customer@example.com",
  "recipientName": "John Doe",
  "subject": "Booking Receipt - Kootenay National Park",
  "locale": "en",
  "templateData": {
    "booking": { /* booking details */ },
    "customer": { /* customer details */ },
    "payment": { /* payment details */ },
    "location": { /* location details */ },
    "branding": { /* branding details */ }
  },
  "metadata": {
    "messageType": "receipt",
    "bookingId": "123456",
    "orderNumber": "ORD-001",
    "region": "kootenay"
  }
}
```

## Integration with Other Stacks

### Dependencies
- **Core Stack**: Provides KMS key for encryption
- Must be deployed before this stack

### Consumers
- **Public API Stack**: Worldline notification handler sends receipt emails
- Other handlers can use the email queue by:
  1. Resolving the queue URL: `scope.resolveEmailQueueUrl(this)`
  2. Adding SQS send permissions to their IAM role
  3. Using the `sendReceiptEmail`, `sendConfirmationEmail`, or `sendCancellationEmail` utility functions

## Exported References

The stack exports these SSM parameters for other stacks to consume:
- `emailQueueUrl`: URL of the email dispatch queue
- `emailQueueArn`: ARN of the email dispatch queue
- `emailTemplatesBucketName`: Name of the email templates bucket
- `emailTemplatesBucketArn`: ARN of the email templates bucket

## Deployment

This stack is automatically deployed as part of the CDK application. It:
1. Creates all resources in the target AWS account
2. Exports references to SSM Parameter Store
3. Grants necessary IAM permissions

## Monitoring and Troubleshooting

### CloudWatch Metrics
Monitor these metrics:
- SQS queue message count (should be near zero)
- DLQ message count (should be zero)
- Lambda invocation count and errors
- Lambda duration

### CloudWatch Logs
Lambda logs include:
- Email processing status
- SES send results
- Template loading errors
- Validation errors

### Common Issues
1. **Emails not sending**: Check SES email verification status
2. **Template not found**: Verify template exists in S3 bucket
3. **Messages in DLQ**: Check Lambda logs for error details
4. **Timeout errors**: Increase Lambda timeout or reduce template complexity

## SES Configuration

Before using this stack, ensure:
1. SES is configured in the target region (ca-central-1)
2. Sender email address is verified in SES
3. SES is moved out of sandbox mode (for production)
4. Appropriate sending limits are configured

## Template Deployment

Email templates are synced to S3 using the CI/CD pipeline:
- GitHub Action: `.github/workflows/email-templates.yml`
- Script: `scripts/sync-email-templates.sh`
- Templates source: `lib/handlers/emailDispatch/templates/`

## Security Considerations

- All queues and buckets use KMS encryption
- S3 bucket has public access blocked
- Lambda uses least-privilege IAM permissions
- SES credentials are not stored (uses IAM role)
- Templates are versioned for audit trail

## Related Documentation

- [Email Dispatch Handler README](../handlers/emailDispatch/README.md)
- [Booking Workflow Stack](../booking-workflow-stack/booking-workflow-stack.js)
- [AWS SES Documentation](https://docs.aws.amazon.com/ses/)
- [AWS SQS Documentation](https://docs.aws.amazon.com/sqs/)
