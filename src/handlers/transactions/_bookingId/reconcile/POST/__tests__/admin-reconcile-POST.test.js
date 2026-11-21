"use strict";

jest.mock("/opt/base", () => {
  const Exception = jest.fn(function (message, options) {
    this.message = message;
    this.code = options?.code;
    this.data = options?.data || null;
  });
  // The authorizer's principal and permissions, as checkAuthContext reads them.
  const claims = (event) => event.requestContext?.authorizer || null;
  return {
    requestIdentity: jest.fn(() => ({})),
    Exception,
    logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
    sendResponse: jest.fn((status, data, message) => ({ status, data, message })),
    getRequestClaimsFromEvent: jest.fn((event) => ({ sub: claims(event)?.principalId })),
    checkAuthContext: jest.fn((event, tier) => {
      const auth = claims(event);
      if (!auth) throw new Exception("Unauthorized", { code: 401 });
      if (auth.role !== tier) throw new Exception("Forbidden", { code: 403 });
      return { sub: auth.principalId };
    }),
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock("/opt/dynamodb", () => ({
  batchWriteData: jest.fn(),
  marshall: jest.fn((value) => value),
  AUDIT_TABLE_NAME: "AuditTable",
}));

jest.mock("../../../../payment-attempts", () => ({ reconcilePayment: jest.fn(), settlePaymentManually: jest.fn() }));

const { writeAuditLog } = require("/opt/base");
const { reconcilePayment, settlePaymentManually } = require("../../../../payment-attempts");
const { handler } = require("../admin");

const BOOKING_ID = "booking-123";
const ADMIN_ID = "admin-123";

const event = (authorizer, body) => ({
  httpMethod: "POST",
  body: body === undefined ? null : JSON.stringify(body),
  pathParameters: { bookingId: BOOKING_ID },
  requestContext: authorizer ? { authorizer } : {},
});
const superadmin = { principalId: ADMIN_ID, role: "superadmin" };

describe("Admin payment reconcile POST handler", () => {
  beforeEach(() => jest.clearAllMocks());

  it("refuses a signed-in admin who is not a superadmin with 403", async () => {
    const result = await handler(event({ principalId: "staff-1", role: "admin" }), {});

    expect(result.status).toBe(403);
    expect(reconcilePayment).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated request with 401", async () => {
    const result = await handler(event(null), {});

    expect(result.status).toBe(401);
    expect(reconcilePayment).not.toHaveBeenCalled();
  });

  it("answers 404 when the booking has no payment lock", async () => {
    reconcilePayment.mockResolvedValue({ lock: null, attempt: null });

    const result = await handler(event(superadmin), {});

    expect(result.status).toBe(404);
  });

  it("returns the reconciled lock and attempt and audits the admin's request", async () => {
    const lock = { status: "paid", activeClientTransactionId: "BCPR-1", needsReconciliation: true };
    const attempt = { clientTransactionId: "BCPR-1", status: "paid" };
    reconcilePayment.mockResolvedValue({ lock, attempt });

    const result = await handler(event(superadmin), {});

    expect(reconcilePayment).toHaveBeenCalledWith(BOOKING_ID);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ lock, attempt });
    expect(writeAuditLog).toHaveBeenCalledWith(
      ADMIN_ID,
      "BCPR-1",
      "ADMIN_PAYMENT_RECONCILE",
      expect.objectContaining({ bookingId: BOOKING_ID, status: "paid" }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("settles by the admin's ruling when the body has a status, and audits it with the reason", async () => {
    const lock = { status: "failed", activeClientTransactionId: "BCPR-1" };
    settlePaymentManually.mockResolvedValue({ lock, attempt: { status: "failed" } });
    const ruling = { status: "failed", reason: "No charge in Worldline" };

    const result = await handler(event(superadmin, ruling), {});

    expect(settlePaymentManually).toHaveBeenCalledWith(BOOKING_ID, { ...ruling, adminId: ADMIN_ID });
    expect(reconcilePayment).not.toHaveBeenCalled();
    expect(result.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalledWith(
      ADMIN_ID,
      "BCPR-1",
      "ADMIN_PAYMENT_SETTLE",
      expect.objectContaining({ status: "failed", reason: "No charge in Worldline" }),
      expect.any(Function),
      expect.any(Function),
      "AuditTable",
    );
  });

  it("refuses a body that is not JSON with 400", async () => {
    const result = await handler({ ...event(superadmin), body: "{" }, {});

    expect(result.status).toBe(400);
    expect(settlePaymentManually).not.toHaveBeenCalled();
  });
});
