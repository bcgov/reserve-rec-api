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

const OWNER = 'user-owner';

describe('Bookings GET handler - QR Code Generation', () => {
  const context = {};

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('QR Code Security', () => {
    it('should NOT fetch a booking or generate a QR code when unauthenticated', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-123' },
      };
      getRequestClaimsFromEvent.mockReturnValue(null);

      const res = await handler(event, context);

      expect(res.status).toBe(401);
      expect(getBookingByBookingId).not.toHaveBeenCalled();
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
    });

    it('should NOT generate QR code when authenticated sub does not own the booking', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-123' },
      };
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-123',
        bookingStatus: 'confirmed',
        userId: OWNER,
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: 'user-wrong' });

      const res = await handler(event, context);

      expect(res.status).toBe(403);
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
    });
  });

  describe('QR Code Generation for Authorized Users', () => {
    it('should generate QR code for confirmed booking when sub matches owner', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-456' },
      };
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-456',
        bookingStatus: 'confirmed',
        userId: OWNER,
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: OWNER });
      generateQRURL.mockReturnValue('https://example.com/verify/booking-456/def456');
      generateQRCodeDataURL.mockResolvedValue('data:image/png;base64,QRCODE2');

      const res = await handler(event, context);

      expect(res.status).toBe(200);
      expect(generateQRURL).toHaveBeenCalledWith('booking-456');
      expect(generateQRCodeDataURL).toHaveBeenCalledWith('https://example.com/verify/booking-456/def456');
      expect(res.data.qrCode).toEqual({
        dataUrl: 'data:image/png;base64,QRCODE2',
        verificationUrl: 'https://example.com/verify/booking-456/def456',
      });
    });

    it('should NOT generate QR code for in-progress bookings even when owner is authorized', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-789' },
      };
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-789',
        bookingStatus: 'in progress',
        userId: OWNER,
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: OWNER });

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
      };
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-cancel',
        bookingStatus: 'cancelled',
        userId: OWNER,
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: OWNER });

      const res = await handler(event, context);

      expect(res.status).toBe(200);
      expect(generateQRURL).not.toHaveBeenCalled();
      expect(generateQRCodeDataURL).not.toHaveBeenCalled();
      expect(res.data.qrCode).toBeNull();
    });
  });

  describe('QR Code Generation Error Handling', () => {
    it('should return booking without QR code if QR generation throws', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-error' },
      };
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-error',
        bookingStatus: 'confirmed',
        userId: OWNER,
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: OWNER });
      generateQRURL.mockImplementation(() => {
        throw new Error('QR generation failed');
      });

      const res = await handler(event, context);

      expect(res.status).toBe(200);
      expect(res.data.bookingId).toBe('booking-error');
      expect(res.data.qrCode).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to generate QR code for booking',
        expect.objectContaining({
          bookingId: 'booking-error',
          error: 'QR generation failed',
        })
      );
    });

    it('should handle QR data-URL generation failure gracefully', async () => {
      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-url-error' },
      };
      getBookingByBookingId.mockResolvedValue({
        bookingId: 'booking-url-error',
        bookingStatus: 'confirmed',
        userId: OWNER,
      });
      getRequestClaimsFromEvent.mockReturnValue({ sub: OWNER });
      generateQRURL.mockReturnValue('https://example.com/verify/booking-url-error/hash');
      generateQRCodeDataURL.mockRejectedValue(new Error('PNG generation failed'));

      const res = await handler(event, context);

      expect(res.status).toBe(200);
      expect(res.data.bookingId).toBe('booking-url-error');
      expect(res.data.qrCode).toBeNull();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('QR Code Timing - Authorization First', () => {
    it('should verify ownership before any QR code processing', async () => {
      const callOrder = [];

      const event = {
        httpMethod: 'GET',
        pathParameters: { bookingId: 'booking-timing' },
      };

      getBookingByBookingId.mockImplementation(async () => {
        callOrder.push('fetchBooking');
        return {
          bookingId: 'booking-timing',
          bookingStatus: 'confirmed',
          userId: OWNER,
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

      getRequestClaimsFromEvent.mockReturnValue({ sub: OWNER });

      await handler(event, context);

      expect(callOrder).toEqual(['fetchBooking', 'generateQRURL', 'generateQRCodeDataURL']);
    });
  });
});
