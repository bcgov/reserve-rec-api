# Email Dispatch System - Testing Guide

## Current Status (As of Dec 4, 2025)

### ✅ Completed Setup
- Email dispatch CDK stack deployed to dev environment
- SES domain `bcparks.ca` verified and DKIM enabled
- S3 bucket `reserve-rec-email-templates-dev` created with templates uploaded
- Lambda function `ReserveRecApi-dev-EmailDispatch` configured and deployed
- SQS queue `reserve-rec-email-queue-dev` with DLQ configured
- 11 test email addresses added to SES (awaiting verification)

### ⏳ Pending Actions
- **Test users must click verification links** in their emails (11 @gov.bc.ca addresses)
- **End-to-end email dispatch testing** (scheduled for next session)
- **SES production access request** (required before customer emails can be sent)

## AWS Resources Summary

### SES Configuration
- **Domain**: `bcparks.ca` (verified, DKIM enabled)
- **Sender Email**: `noreply@bcparks.ca`
- **Region**: `ca-central-1`
- **Status**: SANDBOX MODE (can only send to verified addresses)
- **Daily Limit**: 200 emails
- **Rate Limit**: 1 email/second

### Test Email Addresses (Pending Verification)
Located in: `ses-test-emails.txt` (not committed)

1. mark.lise@gov.bc.ca
2. Lindsay.Macfarlane@gov.bc.ca
3. Nan.1.Yang@gov.bc.ca
4. Pavel.Ganapolsky@gov.bc.ca
5. Meredith.Olsen-Maier@gov.bc.ca
6. Cameron.Pettit@gov.bc.ca
7. Christopher.Walsh@gov.bc.ca
8. Manuji.Samara@gov.bc.ca
9. David.Claveau@gov.bc.ca
10. Winnie.1.Ho@gov.bc.ca
11. Kimia.C.Abhar@gov.bc.ca

**Action Required**: Each person must click the verification link in their AWS SES verification email.

### S3 Templates
- **Bucket**: `reserve-rec-email-templates-dev`
- **Templates Uploaded**:
  - `en/receipt_bcparks_kootenay.html` (10.3 KiB)
  - `en/receipt_bcparks_kootenay.txt` (2.2 KiB)
- **Versioning**: Enabled
- **Backup**: Auto-created at `backups/2025-12-04_16-50-37/`

### Lambda Configuration
- **Function Name**: `ReserveRecApi-dev-EmailDispatch`
- **Runtime**: Node.js 20.x
- **Memory**: 512 MB
- **Timeout**: 3 minutes
- **Trigger**: SQS queue `reserve-rec-email-queue-dev`
- **Environment Variables**:
  ```json
  {
    "EMAIL_QUEUE_URL": "https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev",
    "TEMPLATE_BUCKET_NAME": "reserve-rec-email-templates-dev",
    "SES_FROM_EMAIL": "noreply@bcparks.ca",
    "SES_REGION": "ca-central-1",
    "LOG_LEVEL": "info"
  }
  ```

### SQS Configuration
- **Queue Name**: `reserve-rec-email-queue-dev`
- **Queue URL**: `https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev`
- **DLQ**: `reserve-rec-email-queue-dev-dlq`
- **Visibility Timeout**: 180 seconds (matches Lambda timeout)
- **Max Receive Count**: 3 (retries before DLQ)

## Testing Guide for Next Session

### Prerequisites
1. At least one test email address must be verified in SES
2. AWS CLI configured with profile `623829546818_BCGOV_LZA_Admin`

### Step 1: Check Email Verification Status

```bash
aws sesv2 list-email-identities \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1 \
  --query 'EmailIdentities[?IdentityType==`EMAIL_ADDRESS`].[IdentityName,VerificationStatus]' \
  --output table
```

Look for at least one email with `VerificationStatus: SUCCESS`.

### Step 2: Create Test Email Payload

Create a file `test-email-payload.json`:

```json
{
  "recipientEmail": "VERIFIED_EMAIL@gov.bc.ca",
  "recipientName": "Test User",
  "subject": "BC Parks - Booking Receipt",
  "templateName": "receipt_bcparks_kootenay",
  "locale": "en",
  "templateData": {
    "branding": {
      "primaryColor": "#2c5530",
      "logoUrl": "https://bcparks.ca/logo.png",
      "contactEmail": "reservations@bcparks.ca",
      "contactPhone": "1-800-689-9025",
      "websiteUrl": "https://bcparks.ca"
    },
    "booking": {
      "bookingId": "TEST-001",
      "bookingReference": "KOOT-2024-001",
      "orderNumber": "ORD-12345",
      "orderDate": "2024-12-04T16:00:00Z",
      "startDate": "2024-12-15T14:00:00Z",
      "endDate": "2024-12-18T11:00:00Z",
      "numberOfNights": 3,
      "numberOfGuests": 4,
      "status": "Confirmed"
    },
    "location": {
      "parkName": "Kootenay National Park",
      "facilityName": "Redstreak Campground",
      "siteNumber": "A-42",
      "address": "7556 Main Street East, Radium Hot Springs, BC V0A 1M0"
    },
    "customer": {
      "firstName": "Test",
      "lastName": "User",
      "email": "VERIFIED_EMAIL@gov.bc.ca",
      "phone": "250-555-0123"
    },
    "payment": {
      "totalAmount": 15000,
      "currency": "CAD",
      "transactionId": "TXN-ABC123",
      "paymentMethod": "Credit Card (**** 1234)",
      "itemBreakdown": [
        {
          "description": "Campsite Fee (3 nights @ $50/night)",
          "amount": 15000
        }
      ]
    }
  },
  "metadata": {
    "messageType": "booking_receipt",
    "bookingId": "TEST-001",
    "environment": "dev"
  }
}
```

**Important**: Replace `VERIFIED_EMAIL@gov.bc.ca` with an actual verified email from Step 1.

### Step 3: Send Test Message to SQS

```bash
aws sqs send-message \
  --queue-url https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev \
  --message-body file://test-email-payload.json \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

Expected output:
```json
{
    "MessageId": "...",
    "MD5OfMessageBody": "..."
}
```

### Step 4: Monitor Lambda Execution

Watch CloudWatch logs in real-time:

```bash
aws logs tail /aws/lambda/ReserveRecApi-dev-EmailDispatch \
  --follow \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

Look for:
- ✅ "Email Dispatch Handler started"
- ✅ "Template loaded and cached"
- ✅ "Email sent via SES"
- ✅ "Email dispatch completed"

Or errors:
- ❌ "Template not found"
- ❌ "Invalid email payload"
- ❌ "Failed to send email via SES"

### Step 5: Check Email Delivery

1. **Check recipient inbox** (and spam folder)
2. **Verify email content** renders correctly (HTML version)
3. **Check plain text version** works as fallback

### Step 6: Verify SQS Message Processed

Check that message was removed from queue:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev \
  --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

Expected:
- `ApproximateNumberOfMessages: 0` (no pending messages)
- `ApproximateNumberOfMessagesNotVisible: 0` (no in-flight messages)

### Step 7: Check DLQ (If Test Failed)

If the email failed to send:

```bash
aws sqs receive-message \
  --queue-url https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev-dlq \
  --max-number-of-messages 10 \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

Messages in DLQ indicate failures after 3 retry attempts.

## Common Issues & Solutions

### Issue: "Template not found"
**Cause**: Lambda can't find template in S3
**Solution**: 
```bash
# Verify templates exist in S3
aws s3 ls s3://reserve-rec-email-templates-dev/ --recursive \
  --profile 623829546818_BCGOV_LZA_Admin

# Re-sync templates if missing
AWS_PROFILE=623829546818_BCGOV_LZA_Admin src/scripts/sync-email-templates.sh dev
```

### Issue: "MessageRejected: Email address is not verified"
**Cause**: Recipient email not verified in SES sandbox
**Solution**: 
1. Check verification status (Step 1 above)
2. Resend verification email if needed:
```bash
aws sesv2 create-email-identity \
  --email-identity user@gov.bc.ca \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1
```

### Issue: Email not received
**Possible Causes**:
1. Email in spam/junk folder
2. SES sending limit reached (check quota)
3. Recipient email bounced (check SES bounce notifications)

**Check SES quota**:
```bash
aws sesv2 get-account \
  --profile 623829546818_BCGOV_LZA_Admin \
  --region ca-central-1 \
  --query 'SendQuota'
```

### Issue: Lambda timeout
**Cause**: Lambda exceeded 3-minute timeout
**Solution**: Check CloudWatch logs for bottleneck (S3 read, SES send, etc.)

## Integration with Worldline Payment System

The email dispatch system is integrated with the Worldline payment notification handler:

**File**: `src/handlers/worldlineNotification/constructs.js`

When a payment is successful, the handler sends a message to the email queue to trigger receipt emails.

**Note**: There's a potential issue with `AWS_REGION` environment variable in the Worldline handler that may need fixing later (user requested no changes during setup).

## Next Steps After Testing

### Before Production Launch

1. **Request SES Production Access**:
   - AWS Console → SES → Account dashboard → Request production access
   - Justify use case: "Transactional emails for BC Parks reservation system"
   - Expected timeline: 24-48 hours for approval

2. **Create Additional Email Templates**:
   - Booking confirmation email
   - Booking cancellation email
   - Refund confirmation email
   - Payment failure notification
   - Reminder emails (check-in, check-out)

3. **Add French Translations**:
   - Create `fr/` directory in templates
   - Translate all templates to French
   - Update translation keys in `templateEngine.js`

4. **Set Up Monitoring**:
   - CloudWatch alarms for DLQ messages
   - CloudWatch alarms for Lambda errors
   - SES bounce/complaint notifications
   - Daily email volume metrics

5. **Load Testing**:
   - Test with higher email volumes
   - Verify Lambda concurrency handles load
   - Check SES rate limits (adjust if needed)

6. **Deploy to Test Environment**:
   - Run same deployment steps for test account
   - Verify end-to-end flow in test
   - Get QA approval

## Useful Commands Reference

### Check Lambda Logs
```bash
aws logs tail /aws/lambda/ReserveRecApi-dev-EmailDispatch --follow \
  --profile 623829546818_BCGOV_LZA_Admin --region ca-central-1
```

### List SES Identities
```bash
aws sesv2 list-email-identities \
  --profile 623829546818_BCGOV_LZA_Admin --region ca-central-1
```

### Check SQS Queue Stats
```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.ca-central-1.amazonaws.com/623829546818/reserve-rec-email-queue-dev \
  --attribute-names All \
  --profile 623829546818_BCGOV_LZA_Admin --region ca-central-1
```

### Sync Templates to S3
```bash
AWS_PROFILE=623829546818_BCGOV_LZA_Admin \
  src/scripts/sync-email-templates.sh dev
```

### Check SES Sending Statistics
```bash
aws sesv2 get-account \
  --profile 623829546818_BCGOV_LZA_Admin --region ca-central-1
```

## Files Modified/Created in This Session

### Created
- `.gitignore` - Added `ses-test-emails.txt`
- `ses-test-emails.txt` - Test email list (not committed)
- `docs/email-templates.md` - Template management guide
- `docs/email-dispatch-testing-guide.md` - This file

### Already Existed (from PR #205)
- `lib/email-dispatch-stack/email-dispatch-stack.js` - CDK stack
- `lib/handlers/emailDispatch/index.js` - Lambda handler
- `lib/handlers/emailDispatch/templateEngine.js` - Template engine
- `lib/handlers/emailDispatch/schema.js` - Payload validation
- `lib/handlers/emailDispatch/templates/en/*` - Email templates
- `src/scripts/sync-email-templates.sh` - Template deployment script
- `src/scripts/verify-ses-test-emails.sh` - Email verification script

## Architecture Diagram Reference

See `docs/reserve-rec-architecture.svg` for full system architecture including email dispatch flow.

## Contact & Support

For issues or questions:
- Check CloudWatch logs first
- Review this testing guide
- Consult `docs/email-templates.md` for template management
- Check PR #205 for original implementation details
