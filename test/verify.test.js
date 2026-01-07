/**
 * Unit tests for QR code verification endpoint
 * 
 * Tests cover:
 * - Hash validation
 * - Admin authorization
 * - Booking retrieval
 * - Status validation (confirmed, cancelled, expired, pending)
 * - Error handling (invalid hash, missing booking, unauthorized)
 */

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.QR_SECRET_KEY = 'test-secret-key-for-unit-tests-only-do-not-use-in-production';
process.env.PUBLIC_FRONTEND_DOMAIN = 'test.reserve-rec.bcparks.ca';
process.env.AWS_SAM_LOCAL = 'true'; // Use mock claims

// Mock the base layer
jest.mock('/opt/base', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  sendResponse: jest.fn((code, data, message) => ({
    statusCode: code,
    body: JSON.stringify({ data, message })
  })),
  getRequestClaimsFromEvent: jest.fn(),
  Exception: class Exception extends Error {
    constructor(message, options) {
      super(message);
      this.code = options?.code;
      this.data = options?.data;
    }
  }
}));

// Mock the QR code helper
const { generateQRURL } = require('../lib/handlers/emailDispatch/qrCodeHelper');
jest.mock('../lib/handlers/emailDispatch/qrCodeHelper', () => {
  const actual = jest.requireActual('../lib/handlers/emailDispatch/qrCodeHelper');
  return {
    validateHash: actual.validateHash,
    generateQRURL: actual.generateQRURL,
  };
});

// Mock the bookings methods
const mockGetBookingByBookingId = jest.fn();
jest.mock('../src/handlers/bookings/methods', () => ({
  getBookingByBookingId: mockGetBookingByBookingId,
}));

const { handler } = require('../src/handlers/verify/GET/admin');
const { sendResponse } = require('/opt/base');

describe('Verify Endpoint', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Admin Authorization', () => {
    it('should allow SuperAdmin access', async () => {
      const bookingId = 'BOOK-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      const mockBooking = {
        bookingId: bookingId,
        bookingStatus: 'confirmed',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          valid: true,
          bookingId: bookingId,
        }),
        'Success',
        null,
        {}
      );
    });

    it('should reject non-admin users', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: 'BOOK-123',
          hash: 'somehash',
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-user',
              'cognito:groups': ['RegularUserGroup'],
              email: 'user@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        403,
        expect.any(Object),
        expect.any(String),
        expect.anything(),
        {}
      );
    });

    it('should reject requests without authorization', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: 'BOOK-123',
          hash: 'somehash',
        },
        requestContext: {
          // No authorizer
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        401,
        expect.any(Object),
        expect.any(String),
        expect.anything(),
        {}
      );
    });
  });

  describe('Hash Validation', () => {
    it('should accept valid hash', async () => {
      const bookingId = 'BOOK-VALID-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      const mockBooking = {
        bookingId: bookingId,
        bookingStatus: 'confirmed',
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          valid: true,
        }),
        'Success',
        null,
        {}
      );
    });

    it('should reject invalid hash format', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: 'BOOK-123',
          hash: 'invalid-hash-123', // Invalid format (not 16 hex chars)
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({
          valid: false,
          reason: 'Invalid or expired QR code',
        }),
        'Invalid QR code',
        null,
        {}
      );
    });

    it('should reject hash from different bookingId', async () => {
      const bookingId1 = 'BOOK-123';
      const bookingId2 = 'BOOK-456';
      
      const url1 = generateQRURL(bookingId1);
      const hash1 = url1.split('/').pop();

      // Mock booking exists for bookingId2 (to pass timing attack prevention)
      mockGetBookingByBookingId.mockResolvedValue({
        bookingId: bookingId2,
        bookingStatus: 'confirmed',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      });

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId2, // Different bookingId
          hash: hash1, // Hash from bookingId1
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({
          valid: false,
          reason: 'Invalid or expired QR code',
        }),
        'Invalid QR code',
        null,
        {}
      );
    });
  });

  describe('Booking Status', () => {
    it('should return confirmed booking details', async () => {
      const bookingId = 'BOOK-CONFIRMED-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      const mockBooking = {
        bookingId: bookingId,
        bookingStatus: 'confirmed',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
        collectionId: 'bcparks_kootenay',
        activityType: 'backcountry',
        displayName: 'Kootenay Backcountry Campsite',
        namedOccupant: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '555-1234',
        },
        partyInformation: {
          adult: 2,
          child: 1,
        },
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          valid: true,
          bookingId: bookingId,
          status: 'confirmed',
          statusDetails: expect.objectContaining({
            isConfirmed: true,
            isCancelled: false,
          }),
          booking: expect.objectContaining({
            bookingId: bookingId,
            displayName: 'Kootenay Backcountry Campsite',
            guestName: 'John Doe', // Changed: aggregated name, not full namedOccupant
            partySize: 3, // Changed: total count, not detailed breakdown
            // Security: Should NOT include email, phone, feeInformation, globalId, activityId
          }),
        }),
        'Success',
        null,
        {}
      );

      // Verify sensitive data is NOT in response
      const responseData = sendResponse.mock.calls[0][1];
      expect(responseData.booking.namedOccupant).toBeUndefined();
      expect(responseData.booking.partyInformation).toBeUndefined();
      expect(responseData.booking.feeInformation).toBeUndefined();
      expect(responseData.booking.globalId).toBeUndefined();
      expect(responseData.booking.activityId).toBeUndefined();
      expect(responseData.booking.bookedAt).toBeUndefined();
      expect(responseData.booking.sessionId).toBeUndefined();
      expect(responseData.booking.sessionExpiry).toBeUndefined();
    });

    it('should identify cancelled booking', async () => {
      const bookingId = 'BOOK-CANCELLED-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      const mockBooking = {
        bookingId: bookingId,
        bookingStatus: 'cancelled',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          valid: true,
          status: 'cancelled',
          statusDetails: expect.objectContaining({
            isCancelled: true,
            isConfirmed: false,
          }),
        }),
        'Success',
        null,
        {}
      );
    });

    it('should identify expired session', async () => {
      const bookingId = 'BOOK-EXPIRED-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      const mockBooking = {
        bookingId: bookingId,
        bookingStatus: 'in progress',
        sessionExpiry: '2025-01-01T00:00:00.000Z', // Past date
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          valid: true,
          statusDetails: expect.objectContaining({
            isExpired: true,
          }),
        }),
        'Success',
        null,
        {}
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing bookingId parameter', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: {
          hash: 'somehash',
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        400,
        expect.any(Object),
        expect.any(String),
        expect.anything(),
        {}
      );
    });

    it('should reject invalid bookingId format', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: 'invalid@booking!id', // Invalid characters
          hash: 'a1b2c3d4e5f6g7h8',
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({
          valid: false,
          reason: 'Invalid or expired QR code',
        }),
        'Invalid QR code',
        null,
        {}
      );
    });

    it('should handle booking not found', async () => {
      const bookingId = 'BOOK-NOTFOUND-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      mockGetBookingByBookingId.mockRejectedValue(new Error('Booking not found'));

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'test-admin',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@example.com'
            }
          }
        }
      };

      await handler(event, {});

      // Changed: Returns 400 (not 404) to prevent bookingId enumeration
      expect(sendResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({
          valid: false,
          reason: 'Invalid or expired QR code', // Changed: generic message
        }),
        'Invalid QR code',
        null,
        {}
      );
    });

    it('should handle CORS preflight', async () => {
      const event = {
        httpMethod: 'OPTIONS',
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(200, {}, 'Success', null, {});
    });
  });

  describe('Audit Trail', () => {
    it('should include verification metadata in response', async () => {
      const bookingId = 'BOOK-AUDIT-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      const mockBooking = {
        bookingId: bookingId,
        bookingStatus: 'confirmed',
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = {
        httpMethod: 'GET',
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        },
        requestContext: {
          authorizer: {
            claims: {
              sub: 'admin-user-123',
              'cognito:groups': ['ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup'],
              email: 'admin@bcparks.ca'
            }
          }
        }
      };

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          verificationMetadata: expect.objectContaining({
            verifiedBy: 'admin-user-123',
            verifiedAt: expect.any(String),
            // Changed: verifierEmail removed from response (privacy)
          }),
        }),
        'Success',
        null,
        {}
      );

      // Verify verifierEmail is NOT in response
      const responseData = sendResponse.mock.calls[0][1];
      expect(responseData.verificationMetadata.verifierEmail).toBeUndefined();
    });
  });
});
