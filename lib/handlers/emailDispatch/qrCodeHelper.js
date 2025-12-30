/**
 * QR Code generation and validation helper for booking verification
 * 
 * Generates URL-based QR codes with HMAC signatures that admin staff can scan
 * to verify bookings at park entrances.
 * 
 * SECURITY: Uses HMAC-SHA256 to prevent QR code tampering. The hash is derived
 * from the bookingId and a secret key, making it impossible for users to create
 * fake QR codes.
 * 
 * @module qrCodeHelper
 */

const crypto = require('crypto');
const QRCode = require('qrcode');
const { logger } = require('../../helpers/utils');

// Environment variables - MUST be set or fail fast
const QR_SECRET_KEY = process.env.QR_SECRET_KEY;
const PUBLIC_FRONTEND_DOMAIN = process.env.PUBLIC_FRONTEND_DOMAIN;

/**
 * Validates that required environment variables are set
 * Called at module initialization to fail fast if configuration is missing
 * @throws {Error} If required environment variables are not set
 */
function validateEnvironment() {
  const missing = [];
  
  if (!QR_SECRET_KEY) {
    missing.push('QR_SECRET_KEY');
  }
  
  if (!PUBLIC_FRONTEND_DOMAIN) {
    missing.push('PUBLIC_FRONTEND_DOMAIN');
  }
  
  if (missing.length > 0) {
    const error = new Error(
      `FATAL: Required QR code environment variables not set: ${missing.join(', ')}. ` +
      `Deployment must be stopped. Check Lambda environment configuration.`
    );
    logger.error('QR code environment validation failed', {
      missing,
      message: error.message
    });
    throw error;
  }
  
  logger.debug('QR code environment validated', {
    hasSecretKey: true,
    domain: PUBLIC_FRONTEND_DOMAIN
  });
}

// Validate environment on module load (fail fast)
// Skip validation in test environment (process.env.NODE_ENV === 'test')
if (process.env.NODE_ENV !== 'test') {
  validateEnvironment();
}

/**
 * Generates a verification URL with HMAC hash for a booking
 * 
 * The URL format is: https://{domain}/verify/{bookingId}/{hash}
 * The hash is HMAC-SHA256(bookingId, secret) truncated to 16 characters
 * 
 * @param {string} bookingId - The booking identifier
 * @param {string} [secretKey] - Secret key for HMAC (defaults to env var, for testing only)
 * @returns {string} - Full verification URL with hash
 * @throws {Error} If bookingId is missing or invalid
 */
function generateQRURL(bookingId, secretKey = QR_SECRET_KEY) {
  if (!secretKey) {
    throw new Error('QR_SECRET_KEY not available for URL generation');
  }
  
  if (!bookingId) {
    throw new Error('bookingId is required for QR URL generation');
  }

  // Generate HMAC-SHA256 hash
  const hmac = crypto.createHmac('sha256', secretKey);
  hmac.update(bookingId);
  const hash = hmac.digest('hex').substring(0, 16); // First 16 chars for shorter URLs
  
  // Construct verification URL using the public frontend domain
  const domain = PUBLIC_FRONTEND_DOMAIN || 'localhost:4200'; // Fallback for tests
  const verificationUrl = `https://${domain}/verify/${bookingId}/${hash}`;
  
  logger.debug('QR verification URL generated', {
    bookingId,
    urlLength: verificationUrl.length,
    domain
  });
  
  return verificationUrl;
}

/**
 * Validates that a hash matches the expected value for a booking
 * 
 * Uses constant-time comparison to prevent timing attacks
 * 
 * @param {string} bookingId - The booking identifier
 * @param {string} hash - The hash to validate
 * @param {string} [secretKey] - Secret key for HMAC (defaults to env var, for testing only)
 * @returns {boolean} - True if hash is valid, false otherwise
 */
function validateHash(bookingId, hash, secretKey = QR_SECRET_KEY) {
  if (!secretKey) {
    logger.warn('QR_SECRET_KEY not available for hash validation');
    return false;
  }
  
  if (!bookingId || !hash) {
    logger.debug('Hash validation failed: missing parameters', { 
      hasBookingId: !!bookingId,
      hasHash: !!hash
    });
    return false;
  }

  try {
    const hmac = crypto.createHmac('sha256', secretKey);
    hmac.update(bookingId);
    const expectedHash = hmac.digest('hex').substring(0, 16);
    
    // Use constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(hash, 'utf8'),
      Buffer.from(expectedHash, 'utf8')
    );
    
    logger.debug('Hash validation result', { bookingId, isValid });
    
    return isValid;
  } catch (error) {
    // timingSafeEqual throws if buffers are different lengths
    logger.debug('Hash validation failed', {
      bookingId,
      error: error.message
    });
    return false;
  }
}

/**
 * Generates a QR code as a base64 data URL from a verification URL
 * 
 * The QR code is a PNG image encoded as base64, suitable for embedding
 * directly in HTML emails or web pages.
 * 
 * @param {string} url - The verification URL to encode
 * @returns {Promise<string>} - Base64 data URL of QR code image (data:image/png;base64,...)
 * @throws {Error} If URL is missing or QR generation fails
 */
async function generateQRCodeDataURL(url) {
  if (!url) {
    throw new Error('URL is required for QR code generation');
  }

  try {
    const startTime = Date.now();
    
    // Generate QR code as data URL (base64 PNG)
    const dataUrl = await QRCode.toDataURL(url, {
      errorCorrectionLevel: 'M', // Medium error correction (15% damage recovery)
      type: 'image/png',
      width: 300, // 300x300 pixels (good for email and print)
      margin: 2, // 2-module margin (white border)
      color: {
        dark: '#000000',  // Black QR code
        light: '#FFFFFF'  // White background
      }
    });
    
    const duration = Date.now() - startTime;
    const sizeKB = Math.round(dataUrl.length / 1024);
    
    logger.debug('QR code generated successfully', {
      duration,
      sizeKB,
      urlLength: url.length
    });
    
    return dataUrl;
  } catch (error) {
    logger.error('QR code generation failed', {
      error: error.message,
      stack: error.stack,
      url: url.substring(0, 50) + '...' // Log partial URL for debugging
    });
    throw new Error(`Failed to generate QR code: ${error.message}`);
  }
}

module.exports = {
  generateQRURL,
  validateHash,
  generateQRCodeDataURL,
  validateEnvironment, // Export for testing
};
