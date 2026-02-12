# QR Codes
### QR Code Verification
QR codes are automatically generated for confirmed bookings to enable park staff verification at entry points.
#### Booking Response with QR Code
When retrieving a confirmed booking via `GET /bookings/{bookingId}`, the response includes:
```json
{
  "bookingId": "abc123-...",
  "bookingStatus": "confirmed",
  ...
  "qrCode": {
    "dataUrl": "data:image/png;base64,iVBORw0KG...",
    "verificationUrl": "https://reserve-rec.bcparks.ca/verify/{bookingId}/{hash}"
  }
}
```
**Fields:**
- `dataUrl`: Base64-encoded PNG image (300x300px) for display/printing
- `verificationUrl`: Admin-facing URL containing booking ID and HMAC signature
**Note:** QR codes are only generated for bookings with `bookingStatus: "confirmed"`. Cancelled, pending, or expired bookings return `qrCode: null`.
#### Verification URL Format
```
https://{domain}/verify/{bookingId}/{hash}
```
- **bookingId**: UUID of the booking
- **hash**: 16-character hexadecimal HMAC-SHA256 signature (prevents tampering)
#### Verification Response (Admin Only)
When an admin scans the QR code, the verification endpoint returns:
```json
{
  "valid": true,
  "bookingId": "abc123-...",
  "status": "confirmed",
  "statusDetails": {
    "isConfirmed": true,
    "isCancelled": false,
    "isExpired": false,
    "isPending": false
  },
  "booking": {
    "bookingId": "abc123-...",
    "displayName": "Golden Ears Park - Backcountry Trail",
    "startDate": "2025-06-15",
    "endDate": "2025-06-17",
    "guestName": "John Doe",
    "partySize": 4,
    "collectionId": "...",
    "activityType": "backcountry",
    "entryPoint": "...",
    "exitPoint": "...",
    "vehicleInformation": {...}
  },
  "verificationMetadata": {
    "verifiedAt": "2025-06-15T10:30:00Z",
    "verifiedBy": "admin-user-id"
  }
}
```
**Security:** Only minimal guest information (name, party size) is returned. Email, phone, address, and payment details are excluded to protect privacy.