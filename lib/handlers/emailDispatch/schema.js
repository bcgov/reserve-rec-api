/**
 * Email dispatch payload schema and validation utilities
 */

/**
 * SQS Message Schema for Email Dispatch
 * @typedef {Object} EmailDispatchPayload
 * @property {string} messageType - Type of email (e.g., 'receipt', 'confirmation', 'cancellation')
 * @property {string} templateName - Template identifier (e.g., 'receipt_bcparks_kootenay')
 * @property {string} recipientEmail - Email address of the recipient
 * @property {string} recipientName - Name of the recipient
 * @property {string} subject - Email subject line
 * @property {string} locale - Language locale ('en', 'fr')
 * @property {Object} templateData - Data to inject into the template
 * @property {Object} metadata - Additional metadata for tracking
 * @property {number} timestamp - Unix timestamp when message was created
 */

/**
 * Template Data Schema for Receipt Emails
 * @typedef {Object} ReceiptTemplateData
 * @property {Object} booking - Booking information
 * @property {string} booking.bookingId - Unique booking identifier
 * @property {string} booking.bookingReference - Human-readable booking reference
 * @property {string} booking.orderNumber - Worldline order number
 * @property {string} booking.orderDate - Date of the order (ISO string)
 * @property {string} booking.startDate - Reservation start date
 * @property {string} booking.endDate - Reservation end date
 * @property {number} booking.numberOfNights - Number of nights reserved
 * @property {number} booking.numberOfGuests - Number of guests
 * @property {string} booking.status - Booking status
 * 
 * @property {Object} location - Park/facility information
 * @property {string} location.parkName - Name of the park
 * @property {string} location.facilityName - Name of the facility/campground
 * @property {string} location.siteNumber - Campsite number
 * @property {string} location.region - BC Parks region (e.g., 'kootenay', 'vancouver-island')
 * @property {string} location.address - Physical address
 * 
 * @property {Object} payment - Payment information
 * @property {number} payment.totalAmount - Total amount paid (in cents)
 * @property {string} payment.currency - Currency code (CAD)
 * @property {string} payment.transactionId - Payment transaction ID
 * @property {string} payment.paymentMethod - Payment method used
 * @property {Array} payment.itemBreakdown - Array of line items
 * 
 * @property {Object} customer - Customer information
 * @property {string} customer.firstName - Customer first name
 * @property {string} customer.lastName - Customer last name
 * @property {string} customer.email - Customer email
 * @property {string} customer.phone - Customer phone number
 * @property {Object} customer.address - Billing address
 * 
 * @property {Object} branding - Region-specific branding
 * @property {string} branding.logoUrl - URL to region logo
 * @property {string} branding.primaryColor - Primary brand color
 * @property {string} branding.contactEmail - Region contact email
 * @property {string} branding.contactPhone - Region contact phone
 * @property {string} branding.websiteUrl - Region website URL
 */

/**
 * Validates the email dispatch payload
 * @param {Object} payload - The payload to validate
 * @returns {Object} Validation result with isValid boolean and errors array
 */
function validateEmailPayload(payload) {
  const errors = [];

  // Required fields validation
  const requiredFields = [
    'messageType',
    'templateName', 
    'recipientEmail',
    'recipientName',
    'subject',
    'locale',
    'templateData',
    'timestamp'
  ];

  requiredFields.forEach(field => {
    if (!payload[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  });

  // Email format validation
  if (payload.recipientEmail && !isValidEmail(payload.recipientEmail)) {
    errors.push('Invalid email format for recipientEmail');
  }

  // Locale validation
  if (payload.locale && !['en', 'fr'].includes(payload.locale)) {
    errors.push('Invalid locale. Must be "en" or "fr"');
  }

  // Template name format validation
  if (payload.templateName && !isValidTemplateName(payload.templateName)) {
    errors.push('Invalid template name format. Expected format: {type}_{brand}_{region}');
  }

  // Message type validation
  const validMessageTypes = ['receipt', 'confirmation', 'cancellation', 'reminder'];
  if (payload.messageType && !validMessageTypes.includes(payload.messageType)) {
    errors.push(`Invalid messageType. Must be one of: ${validMessageTypes.join(', ')}`);
  }

  // Template data validation for receipts
  if (payload.messageType === 'receipt' && payload.templateData) {
    const templateErrors = validateReceiptTemplateData(payload.templateData);
    errors.push(...templateErrors);
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Validates receipt-specific template data
 * @param {Object} templateData - The template data to validate
 * @returns {Array} Array of validation errors
 */
function validateReceiptTemplateData(templateData) {
  const errors = [];

  // Booking validation
  if (!templateData.booking) {
    errors.push('Missing booking information in templateData');
  } else {
    const booking = templateData.booking;
    const requiredBookingFields = [
      'bookingId', 'orderNumber', 'orderDate', 'startDate', 'status'
    ];
    
    requiredBookingFields.forEach(field => {
      if (!booking[field]) {
        errors.push(`Missing booking.${field}`);
      }
    });
  }

  // Location validation
  if (!templateData.location) {
    errors.push('Missing location information in templateData');
  } else {
    const location = templateData.location;
    const requiredLocationFields = ['parkName', 'region'];
    
    requiredLocationFields.forEach(field => {
      if (!location[field]) {
        errors.push(`Missing location.${field}`);
      }
    });
  }

  // Payment validation
  if (!templateData.payment) {
    errors.push('Missing payment information in templateData');
  } else {
    const payment = templateData.payment;
    const requiredPaymentFields = ['totalAmount', 'currency', 'transactionId'];
    
    requiredPaymentFields.forEach(field => {
      if (!payment[field]) {
        errors.push(`Missing payment.${field}`);
      }
    });

    if (payment.totalAmount && (typeof payment.totalAmount !== 'number' || payment.totalAmount <= 0)) {
      errors.push('payment.totalAmount must be a positive number');
    }
  }

  // Customer validation
  if (!templateData.customer) {
    errors.push('Missing customer information in templateData');
  } else {
    const customer = templateData.customer;
    const requiredCustomerFields = ['firstName', 'lastName', 'email'];
    
    requiredCustomerFields.forEach(field => {
      if (!customer[field]) {
        errors.push(`Missing customer.${field}`);
      }
    });

    if (customer.email && !isValidEmail(customer.email)) {
      errors.push('Invalid email format for customer.email');
    }
  }

  return errors;
}

/**
 * Validates email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validates template name format
 * @param {string} templateName - Template name to validate
 * @returns {boolean} True if valid format
 */
function isValidTemplateName(templateName) {
  // Format: {type}_{brand}_{region} e.g., receipt_bcparks_kootenay
  const templateRegex = /^[a-z]+_[a-z]+_[a-z]+$/;
  return templateRegex.test(templateName);
}

/**
 * Creates a standardized SQS message payload
 * @param {Object} params - Parameters for creating the payload
 * @returns {Object} Formatted payload ready for SQS
 */
function createEmailPayload(params) {
  const {
    messageType,
    templateName,
    recipientEmail,
    recipientName,
    subject,
    locale = 'en',
    templateData,
    metadata = {}
  } = params;

  const payload = {
    messageType,
    templateName,
    recipientEmail,
    recipientName,
    subject,
    locale,
    templateData,
    metadata: {
      ...metadata,
      source: 'reserve-rec-api',
      version: '1.0'
    },
    timestamp: Date.now()
  };

  return payload;
}

module.exports = {
  validateEmailPayload,
  validateReceiptTemplateData,
  createEmailPayload,
  isValidEmail,
  isValidTemplateName
};