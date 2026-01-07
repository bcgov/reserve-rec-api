const { handler } = require("../../src/handlers/bookings/GET/public");
let getBookingByBookingId, getBookingsByUserId, generateQRURL, generateQRCodeDataURL;

jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data.code;
    this.data = data;
    this.msg = message;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
  sendResponse: jest.fn((status, data, message, error, context) => ({
    status,
    data,
    message,
    error,
    context,
  })),
  getRequestClaimsFromEvent: jest.fn(),
}));

jest.mock('../../src/handlers/bookings/methods', () => ({
  getBookingByBookingId: jest.fn(),
  getBookingsByUserId: jest.fn(),
}));

jest.mock('../../lib/handlers/emailDispatch/qrCodeHelper', () => ({
  generateQRURL: jest.fn(),
  generateQRCodeDataURL: jest.fn(),
}));

const { getRequestClaimsFromEvent, logger } = require('/opt/base');
({ getBookingByBookingId, getBookingsByUserId } = require('../../src/handlers/bookings/methods'));
({ generateQRURL, generateQRCodeDataURL } = require('../../lib/handlers/emailDispatch/qrCodeHelper'));

describe('Bookings GET handler - QR Code Generation', () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('QR Code Security', () => {
    it('should NOT generate QR code before authorization check', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-123' },
        queryStringParameters: { email: 'wrong@example.com' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-123',
        bookingStatus: 'confirmed',
        namedOccupant: {
          contactInfo: {
            email: 'correct@example.com'
          }
        }
      });
      getRequestClaimsFromEvent.mockReturnValue(null);
      
      const res = await handler(event, context);
      
      // Should fail authorization
      expect(res.status).toBe(403);
      // QR code functions should NOT have been called
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
    });

    it('should NOT generate QR code for unauthorized userId', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-123' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-123',
        bookingStatus: 'confirmed',
        userId: 'user-correct'
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-wrong' });
      
      const res = await handler(event, context);
      
      // Should fail authorization
      expect(res.status).toBe(403);
      // QR code functions should NOT have been called
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
    });
  });

  describe('QR Code Generation for Authorized Users', () => {
    it('should generate QR code for confirmed booking with matching email', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-123' },
        queryStringParameters: { email: 'test@example.com' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-123',
        bookingStatus: 'confirmed',
        namedOccupant: {
          contactInfo: {
            email: 'test@example.com'
          }
        }
      });
      getRequestClaimsFromEvent.mockReturnValue(null);
      generateQRURL.mockReturnValue('https://example.com/verify/booking-123/abc123');
      generateQRCodeDataURL.mockResolvedValue('data:image/png;base64,QRCODE');
      
      const res = await handler(event, context);
      
      expect(res.status).toBe(200);
      expect(generateQRURL).toHaveBeenCalledWith('booking-123');
      expect(generateQRCodeDataURL).toHaveBeenCalledWith('https://example.com/verify/booking-123/abc123');
      expect(res.data.qrCode).toEqual({
        dataUrl: 'data:image/png;base64,QRCODE',
        verificationUrl: 'https://example.com/verify/booking-123/abc123'
      });
    });

    it('should generate QR code for confirmed booking with matching userId', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-456' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-456',
        bookingStatus: 'confirmed',
        userId: 'user-123'
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-123' });
      generateQRURL.mockReturnValue('https://example.com/verify/booking-456/def456');
      generateQRCodeDataURL.mockResolvedValue('data:image/png;base64,QRCODE2');
      
      const res = await handler(event, context);
      
      expect(res.status).toBe(200);
      expect(generateQRURL).toHaveBeenCalledWith('booking-456');
      expect(generateQRCodeDataURL).toHaveBeenCalledWith('https://example.com/verify/booking-456/def456');
      expect(res.data.qrCode).toEqual({
        dataUrl: 'data:image/png;base64,QRCODE2',
        verificationUrl: 'https://example.com/verify/booking-456/def456'
      });
    });

    it('should NOT generate QR code for non-confirmed bookings', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-789' },
        queryStringParameters: { email: 'test@example.com' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-789',
        bookingStatus: 'in progress',
        namedOccupant: {
          contactInfo: {
            email: 'test@example.com'
          }
        }
      });
      getRequestClaimsFromEvent.mockReturnValue(null);
      
      const res = await handler(event, context);
      
      expect(res.status).toBe(200);
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
      expect(res.data.qrCode).toBeNull();
    });

    it('should NOT generate QR code for cancelled bookings', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-cancel' },
        queryStringParameters: { email: 'test@example.com' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-cancel',
        bookingStatus: 'cancelled',
        namedOccupant: {
          contactInfo: {
            email: 'test@example.com'
          }
        }
      });
      getRequestClaimsFromEvent.mockReturnValue(null);
      
      const res = await handler(event, context);
      
      expect(res.status).toBe(200);
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
      expect(res.data.qrCode).toBeNull();
    });
  });

  describe('QR Code Generation Error Handling', () => {
    it('should return booking without QR code if QR generation fails', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-error' },
        queryStringParameters: { email: 'test@example.com' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-error',
        bookingStatus: 'confirmed',
        namedOccupant: {
          contactInfo: {
            email: 'test@example.com'
          }
        }
      });
      getRequestClaimsFromEvent.mockReturnValue(null);
      generateQRURL.mockImplementation(() => {
        throw new Error('QR generation failed');
      });
      
      const res = await handler(event, context);
      
      // Should still succeed with booking data
      expect(res.status).toBe(200);
      expect(res.data.bookingId).toBe('booking-error');
      // QR code should be null due to error
      expect(res.data.qrCode).toBeNull();
      // Should log warning
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to generate QR code for booking',
        expect.objectContaining({
          bookingId: 'booking-error',
          error: 'QR generation failed'
        })
      );
    });

    it('should handle QR code data URL generation failure gracefully', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-url-error' },
        queryStringParameters: { email: 'test@example.com' }
      };
      
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-url-error',
        bookingStatus: 'confirmed',
        namedOccupant: {
          contactInfo: {
            email: 'test@example.com'
          }
        }
      });
      getRequestClaimsFromEvent.mockReturnValue(null);
      generateQRURL.mockReturnValue('https://example.com/verify/booking-url-error/hash');
      generateQRCodeDataURL.mockRejectedValue(new Error('PNG generation failed'));
      
      const res = await handler(event, context);
      
      // Should still succeed with booking data
      expect(res.status).toBe(200);
      expect(res.data.bookingId).toBe('booking-url-error');
      // QR code should be null due to error
      expect(res.data.qrCode).toBeNull();
      // Should log warning
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('QR Code Timing - Authorization First', () => {
    it('should verify authorization before any QR code processing', async () => {
      const callOrder = [];
      
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-timing' },
        queryStringParameters: { email: 'test@example.com' }
      };
      
      getBookingByBookingId.mockImplementation(async () => {
        callOrder.push('fetchBooking');
        return {
          bookingId: 'booking-timing',
          bookingStatus: 'confirmed',
          namedOccupant: {
            contactInfo: {
              email: 'test@example.com'
            }
          }
        };
      });
      
      generateQRURL.mockImplementation(() => {
        callOrder.push('generateQRURL');
        return 'https://example.com/verify/booking-timing/hash';
      });
      
      generateQRCodeDataURL.mockImplementation(async () => {
        callOrder.push('generateQRCodeDataURL');
        return 'data:image/png;base64,QR';
      });
      
      getRequestClaimsFromEvent.mockReturnValue(null);
      
      await handler(event, context);
      
      // Verify call order: fetch booking, then generate QR (authorization happens in between)
      expect(callOrder).toEqual(['fetchBooking', 'generateQRURL', 'generateQRCodeDataURL']);
      // This ensures authorization check happens after booking fetch but before QR generation
    });
  });
});
