/**
 * Unit tests for QR code verification endpoint
 *
 * Tests cover:
 * - Hash validation
 * - Admin authorization (via checkAuthContext)
 * - Booking retrieval
 * - Response shape / PII minimisation
 * - Error handling (invalid hash, missing booking, unauthorized)
 */

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.QR_SECRET_KEY = 'test-secret-key-for-unit-tests-only-do-not-use-in-production';
process.env.ADMIN_ALTERED_FRONTEND_DOMAIN = 'test.admin.reserve-rec.bcparks.ca';

const SUPERADMIN_GROUP = 'ReserveRecApi-Dev-AdminIdentityStack-SuperAdminGroup';

const MOCK_ADMIN_CLAIMS = {
  sub: 'test-admin',
  'cognito:groups': [SUPERADMIN_GROUP],
  email: 'admin@example.com'
};

const MOCK_REGULAR_USER_CLAIMS = {
  sub: 'test-user',
  'cognito:groups': ['RegularUserGroup'],
  email: 'user@example.com'
};

function createMockEvent(overrides = {}) {
  return {
    httpMethod: 'GET',
    pathParameters: {},
    requestContext: {},
    ...overrides
  };
}

function createAdminEvent(overrides = {}) {
  return createMockEvent({
    requestContext: {
      authorizer: {
        claims: { ...MOCK_ADMIN_CLAIMS, ...overrides.claims }
      }
    },
    ...overrides
  });
}

// Mock the base layer
jest.mock('/opt/base', () => {
  class Exception extends Error {
    constructor(message, errorData) {
      super(message);
      this.code = errorData?.code || null;
      this.error = errorData?.error || null;
      this.msg = message || null;
      this.data = errorData?.data || null;
    }
  }
  return {
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
    handleCORS: jest.fn((event, context) => {
      if (event?.httpMethod === 'OPTIONS') {
        return { statusCode: 200, body: JSON.stringify({ data: {}, message: 'Success' }) };
      }
      return null;
    }),
    calculatePartySize: jest.fn((partyInfo) => {
      if (!partyInfo) return 0;
      return (partyInfo.adult || 0) + (partyInfo.senior || 0) + (partyInfo.youth || 0) + (partyInfo.child || 0);
    }),
    VALIDATION_PATTERNS: {
      BOOKING_ID: /^[a-zA-Z0-9-_]{8,100}$/,
      QR_HASH: /^[a-f0-9]{16}$/i
    },
    writeAuditLog: jest.fn(),
    // The handler gates on checkAuthContext(event, 'limited'). Stand in for the real
    // layer implementation: no authorizer claims -> 401, non-superadmin -> 403.
    checkAuthContext: jest.fn((event) => {
      const claims = event?.requestContext?.authorizer?.claims;
      if (!claims) {
        throw new Exception('Unauthorized - Invalid permissions format', { code: 401 });
      }
      if (!(claims['cognito:groups'] || []).some((g) => g.includes('SuperAdminGroup'))) {
        throw new Exception(
          'Unauthorized: User does not have the required permission tier for this operation.',
          { code: 403 }
        );
      }
      return { sub: claims.sub, permissions: { superadmin: 'superadmin' } };
    }),
    Exception,
  };
});

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
const { sendResponse, writeAuditLog } = require('/opt/base');

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
        status: 'confirmed',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      expect(mockGetBookingByBookingId).toHaveBeenCalledWith(bookingId, null, true);
      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          bookingId: bookingId,
          status: 'confirmed',
        }),
        'Success',
        null,
        {}
      );
    });

    it('should reject non-admin users', async () => {
      const event = createMockEvent({
        pathParameters: {
          bookingId: 'BOOK-123',
          hash: 'somehash',
        },
        requestContext: {
          authorizer: {
            claims: MOCK_REGULAR_USER_CLAIMS
          }
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        403,
        null,
        expect.any(String),
        expect.anything(),
        {}
      );
      expect(mockGetBookingByBookingId).not.toHaveBeenCalled();
    });

    it('should reject requests without authorization', async () => {
      const event = createMockEvent({
        pathParameters: {
          bookingId: 'BOOK-123',
          hash: 'somehash',
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        401,
        null,
        expect.any(String),
        expect.anything(),
        {}
      );
      expect(mockGetBookingByBookingId).not.toHaveBeenCalled();
    });
  });

  describe('Hash Validation', () => {
    it('should accept valid hash', async () => {
      const bookingId = 'BOOK-VALID-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      mockGetBookingByBookingId.mockResolvedValue({
        bookingId: bookingId,
        status: 'confirmed',
      });

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ bookingId: bookingId }),
        'Success',
        null,
        {}
      );
    });

    it('should reject invalid hash format', async () => {
      const event = createAdminEvent({
        pathParameters: {
          bookingId: 'BOOK-123',
          hash: 'invalid-hash-123', // Invalid format (not 16 hex chars)
        }
      });

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
        status: 'confirmed',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      });

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId2, // Different bookingId
          hash: hash1, // Hash from bookingId1
        }
      });

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
        status: 'confirmed',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
        collectionId: 'bcparks_kootenay',
        activityType: 'backcountry',
        displayName: 'Kootenay Backcountry Campsite',
        globalId: 'global-1',
        activityId: 'activity-1',
        sessionId: 'session-1',
        sessionExpiry: '2025-01-01T00:00:00.000Z',
        feeInformation: { total: 100 },
        namedOccupant: {
          firstName: 'John',
          lastName: 'Doe',
          contactInfo: { email: 'john.doe@example.com' },
          phone: '555-1234',
        },
        partyInformation: {
          adult: 2,
          child: 1,
        },
      };

      mockGetBookingByBookingId.mockResolvedValue(mockBooking);

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          bookingId: bookingId,
          displayName: 'Kootenay Backcountry Campsite',
          status: 'confirmed',
          startDate: '2025-12-20',
          endDate: '2025-12-22',
          collectionId: 'bcparks_kootenay',
          activityType: 'backcountry',
          // Guest details are flattened out of namedOccupant
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          partySize: 3,
        }),
        'Success',
        null,
        {}
      );

      // Verify sensitive/internal data is NOT in the response
      const responseData = sendResponse.mock.calls[0][1];
      expect(responseData.namedOccupant).toBeUndefined();
      expect(responseData.feeInformation).toBeUndefined();
      expect(responseData.globalId).toBeUndefined();
      expect(responseData.activityId).toBeUndefined();
      expect(responseData.sessionId).toBeUndefined();
      expect(responseData.sessionExpiry).toBeUndefined();
      expect(responseData.bookedAt).toBeUndefined();
    });

    it('should identify cancelled booking', async () => {
      const bookingId = 'BOOK-CANCELLED-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      mockGetBookingByBookingId.mockResolvedValue({
        bookingId: bookingId,
        status: 'cancelled',
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      });

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ status: 'cancelled' }),
        'Success',
        null,
        {}
      );
    });

    it('should return checkOutTime and checkedInTime for status calculation', async () => {
      const bookingId = 'BOOK-INPROGRESS-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      mockGetBookingByBookingId.mockResolvedValue({
        bookingId: bookingId,
        status: 'in progress',
        checkedInTime: '2025-12-20T18:00:00.000Z',
        reservationContext: { checkOutTime: '2025-12-22T11:00:00.000Z', internalNote: 'secret' },
        startDate: '2025-12-20',
        endDate: '2025-12-22',
      });

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          status: 'in progress',
          checkedInTime: '2025-12-20T18:00:00.000Z',
          reservationContext: { checkOutTime: '2025-12-22T11:00:00.000Z' },
        }),
        'Success',
        null,
        {}
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing bookingId parameter', async () => {
      const event = createAdminEvent({
        pathParameters: {
          hash: 'somehash',
        }
      });

      await handler(event, {});

      expect(sendResponse).toHaveBeenCalledWith(
        400,
        null,
        expect.any(String),
        expect.anything(),
        {}
      );
    });

    it('should reject invalid bookingId format', async () => {
      const event = createAdminEvent({
        pathParameters: {
          bookingId: 'invalid@booking!id', // Invalid characters
          hash: 'a1b2c3d4e5f6g7h8',
        }
      });

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

      const event = createAdminEvent({
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      // Returns 400 (not 404) to prevent bookingId enumeration
      expect(sendResponse).toHaveBeenCalledWith(
        400,
        expect.objectContaining({
          valid: false,
          reason: 'Invalid or expired QR code', // generic message
        }),
        'Invalid QR code',
        null,
        {}
      );
    });

    it('should handle CORS preflight', async () => {
      const event = { httpMethod: 'OPTIONS' };

      const result = await handler(event, {});

      // handleCORS mock returns the response directly
      expect(result).toBeDefined();
      expect(result.statusCode).toBe(200);
    });
  });

  describe('Audit Trail', () => {
    it('should write a successful verification to the audit log', async () => {
      const bookingId = 'BOOK-AUDIT-123';
      const url = generateQRURL(bookingId);
      const hash = url.split('/').pop();

      mockGetBookingByBookingId.mockResolvedValue({
        bookingId: bookingId,
        status: 'confirmed',
        collectionId: 'bcparks_kootenay',
        activityType: 'backcountry',
        partyInformation: { adult: 2 },
      });

      const event = createAdminEvent({
        claims: { sub: 'admin-user-123', email: 'admin@bcparks.ca' },
        pathParameters: {
          bookingId: bookingId,
          hash: hash,
        }
      });

      await handler(event, {});

      expect(writeAuditLog).toHaveBeenCalledWith(
        'admin-user-123',
        bookingId,
        'QR_VERIFY_SUCCESS',
        expect.objectContaining({
          status: 'confirmed',
          partySize: 2,
          collectionId: 'bcparks_kootenay',
          activityType: 'backcountry',
          timestamp: expect.any(String),
        }),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should write an unauthorized attempt to the audit log', async () => {
      const event = createMockEvent({
        pathParameters: { bookingId: 'BOOK-123', hash: 'somehash' },
      });

      await handler(event, {});

      expect(writeAuditLog).toHaveBeenCalledWith(
        'UNAUTHORIZED',
        'BOOK-123',
        'QR_VERIFY_UNAUTHORIZED',
        expect.objectContaining({ reason: expect.any(String) }),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });
});
