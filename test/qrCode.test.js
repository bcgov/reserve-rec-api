/**
 * Unit tests for QR code generation and validation
 * 
 * Tests cover:
 * - URL generation with HMAC hashing
 * - Hash validation (timing-safe comparison)
 * - QR code image generation (base64 data URLs)
 * - Environment variable validation (fail-fast behavior)
 */

// Mock environment variables for testing
process.env.NODE_ENV = 'test'; // Bypass environment validation
process.env.QR_SECRET_KEY = 'test-secret-key-for-unit-tests-only-do-not-use-in-production';
process.env.PUBLIC_FRONTEND_DOMAIN = 'test.reserve-rec.bcparks.ca';

const { generateQRURL, validateHash, generateQRCodeDataURL, validateEnvironment } = require('../lib/handlers/emailDispatch/qrCodeHelper');

describe('QR Code Helper', () => {
  
  describe('generateQRURL', () => {
    it('should generate a valid URL with hash', () => {
      const bookingId = 'BOOK-12345';
      const url = generateQRURL(bookingId);
      
      expect(url).toContain('https://test.reserve-rec.bcparks.ca/verify/BOOK-12345/');
      expect(url.split('/').length).toBe(6); // https: / / domain / verify / bookingId / hash
      
      // Hash should be 16 characters
      const hash = url.split('/').pop();
      expect(hash.length).toBe(16);
    });

    it('should generate consistent hashes for the same bookingId', () => {
      const bookingId = 'BOOK-12345';
      const url1 = generateQRURL(bookingId);
      const url2 = generateQRURL(bookingId);
      
      expect(url1).toBe(url2);
    });

    it('should generate different hashes for different bookingIds', () => {
      const url1 = generateQRURL('BOOK-12345');
      const url2 = generateQRURL('BOOK-67890');
      
      expect(url1).not.toBe(url2);
      
      const hash1 = url1.split('/').pop();
      const hash2 = url2.split('/').pop();
      expect(hash1).not.toBe(hash2);
    });

    it('should throw error if bookingId is missing', () => {
      expect(() => generateQRURL(null)).toThrow('bookingId is required');
      expect(() => generateQRURL(undefined)).toThrow('bookingId is required');
      expect(() => generateQRURL('')).toThrow('bookingId is required');
    });

    it('should throw error if secret key is missing', () => {
      expect(() => generateQRURL('BOOK-123', null)).toThrow('QR_SECRET_KEY not available');
    });

    it('should handle bookingIds with special characters', () => {
      const bookingIds = [
        'BOOK-123-456',
        'BOOK_ABC_XYZ',
        'BOOK.TEST.001',
        'BOOK#2025'
      ];

      bookingIds.forEach(bookingId => {
        const url = generateQRURL(bookingId);
        expect(url).toContain(bookingId);
        expect(url).toMatch(/^https:\/\//);
      });
    });
  });

  describe('validateHash', () => {
    it('should validate a correct hash', () => {
      const bookingId = 'BOOK-12345';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();
      
      const isValid = validateHash(bookingId, hash);
      expect(isValid).toBe(true);
    });

    it('should reject an incorrect hash', () => {
      const bookingId = 'BOOK-12345';
      const wrongHash = 'incorrecthash123';
      
      const isValid = validateHash(bookingId, wrongHash);
      expect(isValid).toBe(false);
    });

    it('should reject hash from different bookingId', () => {
      const url1 = generateQRURL('BOOK-12345');
      const hash1 = url1.split('/').pop();
      
      const isValid = validateHash('BOOK-67890', hash1);
      expect(isValid).toBe(false);
    });

    it('should return false if bookingId is missing', () => {
      expect(validateHash(null, 'somehash')).toBe(false);
      expect(validateHash(undefined, 'somehash')).toBe(false);
      expect(validateHash('', 'somehash')).toBe(false);
    });

    it('should return false if hash is missing', () => {
      expect(validateHash('BOOK-123', null)).toBe(false);
      expect(validateHash('BOOK-123', undefined)).toBe(false);
      expect(validateHash('BOOK-123', '')).toBe(false);
    });

    it('should return false if hash is wrong length', () => {
      const bookingId = 'BOOK-12345';
      
      // Too short
      expect(validateHash(bookingId, 'abc')).toBe(false);
      
      // Too long
      expect(validateHash(bookingId, 'a'.repeat(32))).toBe(false);
    });

    it('should return false if secret key is missing', () => {
      const isValid = validateHash('BOOK-123', 'somehash', null);
      expect(isValid).toBe(false);
    });

    it('should use constant-time comparison (timing attack resistance)', () => {
      const bookingId = 'BOOK-12345';
      const url = generateQRURL(bookingId);
      const correctHash = url.split('/').pop();
      
      // Create hash that matches first few characters but not all
      const partialMatchHash = correctHash.substring(0, 8) + '12345678';
      
      const isValid = validateHash(bookingId, partialMatchHash);
      expect(isValid).toBe(false);
      
      // Should not leak timing information about partial matches
      // (this test doesn't measure timing, but verifies the logic)
    });
  });

  describe('generateQRCodeDataURL', () => {
    it('should generate a base64 data URL', async () => {
      const url = 'https://test.reserve-rec.bcparks.ca/verify/BOOK-123/abc123';
      const dataUrl = await generateQRCodeDataURL(url);
      
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(dataUrl.length).toBeGreaterThan(100); // QR codes are substantial in size
    });

    it('should throw error if URL is missing', async () => {
      await expect(generateQRCodeDataURL(null)).rejects.toThrow('URL is required');
      await expect(generateQRCodeDataURL(undefined)).rejects.toThrow('URL is required');
      await expect(generateQRCodeDataURL('')).rejects.toThrow('URL is required');
    });

    it('should generate consistent QR codes for the same URL', async () => {
      const url = 'https://test.reserve-rec.bcparks.ca/verify/BOOK-123/abc123';
      const dataUrl1 = await generateQRCodeDataURL(url);
      const dataUrl2 = await generateQRCodeDataURL(url);
      
      expect(dataUrl1).toBe(dataUrl2);
    });

    it('should generate different QR codes for different URLs', async () => {
      const url1 = 'https://test.reserve-rec.bcparks.ca/verify/BOOK-123/abc123';
      const url2 = 'https://test.reserve-rec.bcparks.ca/verify/BOOK-456/def456';
      
      const dataUrl1 = await generateQRCodeDataURL(url1);
      const dataUrl2 = await generateQRCodeDataURL(url2);
      
      expect(dataUrl1).not.toBe(dataUrl2);
    });

    it('should handle long URLs', async () => {
      const longUrl = 'https://test.reserve-rec.bcparks.ca/verify/' + 'A'.repeat(100) + '/abc123';
      const dataUrl = await generateQRCodeDataURL(longUrl);
      
      expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('should return valid base64 encoded image', async () => {
      const url = 'https://test.reserve-rec.bcparks.ca/verify/BOOK-123/abc123';
      const dataUrl = await generateQRCodeDataURL(url);
      
      // Extract base64 portion
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
      
      // Should be valid base64 (no invalid characters)
      expect(base64Data).toMatch(/^[A-Za-z0-9+/=]+$/);
      
      // Should be decodable (doesn't throw)
      expect(() => Buffer.from(base64Data, 'base64')).not.toThrow();
    });

    it('should generate QR code in reasonable time', async () => {
      const url = 'https://test.reserve-rec.bcparks.ca/verify/BOOK-123/abc123';
      
      const startTime = Date.now();
      await generateQRCodeDataURL(url);
      const duration = Date.now() - startTime;
      
      // Should complete in less than 500ms (generous threshold)
      expect(duration).toBeLessThan(500);
    });
  });

  describe('validateEnvironment', () => {
    it('should pass when all environment variables are set', () => {
      // Save originals
      const originalQRSecret = process.env.QR_SECRET_KEY;
      const originalDomain = process.env.PUBLIC_FRONTEND_DOMAIN;
      const originalNodeEnv = process.env.NODE_ENV;
      
      // Set valid environment
      process.env.QR_SECRET_KEY = 'test-secret-key';
      process.env.PUBLIC_FRONTEND_DOMAIN = 'test.domain.com';
      process.env.NODE_ENV = 'production';
      
      expect(() => validateEnvironment()).not.toThrow();
      
      // Restore
      process.env.QR_SECRET_KEY = originalQRSecret;
      process.env.PUBLIC_FRONTEND_DOMAIN = originalDomain;
      process.env.NODE_ENV = originalNodeEnv;
    });

    // Note: Cannot test missing environment variable scenarios in unit tests
    // because validateEnvironment() is called at module load time (fail-fast).
    // If env vars are missing, the module won't load and tests won't run.
    // This is intentional - we want Lambda to fail immediately on startup
    // rather than at runtime when generating QR codes.
  });

  describe('Integration: Full QR Code Flow', () => {
    it('should generate QR code that can be validated', async () => {
      const bookingId = 'INTEGRATION-TEST-123';
      
      // Step 1: Generate verification URL
      const verificationUrl = generateQRURL(bookingId);
      expect(verificationUrl).toBeTruthy();
      
      // Step 2: Extract bookingId and hash from URL
      const urlParts = verificationUrl.split('/');
      const extractedBookingId = urlParts[urlParts.length - 2];
      const extractedHash = urlParts[urlParts.length - 1];
      
      expect(extractedBookingId).toBe(bookingId);
      
      // Step 3: Validate the hash
      const isValid = validateHash(extractedBookingId, extractedHash);
      expect(isValid).toBe(true);
      
      // Step 4: Generate QR code image
      const qrCodeDataUrl = await generateQRCodeDataURL(verificationUrl);
      expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
    });

    it('should detect tampering attempt', () => {
      const bookingId = 'BOOK-ORIGINAL';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();
      
      // Attacker tries to use hash with different bookingId
      const tamperedBookingId = 'BOOK-TAMPERED';
      const isValid = validateHash(tamperedBookingId, hash);
      
      expect(isValid).toBe(false);
    });
  });
});
