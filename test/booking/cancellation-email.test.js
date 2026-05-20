"use strict";

// Mock /opt/* layers and the modules that methods.js pulls in at require-time.
jest.mock("/opt/base", () => ({
  Exception: jest.fn(function (message, data) {
    this.message = message;
    this.code = data?.code;
    this.data = data;
  }),
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("/opt/dynamodb", () => ({
  TRANSACTIONAL_DATA_TABLE_NAME: "trans",
  REFERENCE_DATA_TABLE_NAME: "ref",
  SPARSE_GSI1_NAME: "gsi1",
  USERID_INDEX_NAME: "userIdx",
  USERID_PROPERTY_NAME: "userId",
  getOneByGlobalId: jest.fn(),
  marshall: jest.fn((x) => x),
  runQuery: jest.fn(),
  getOne: jest.fn(),
}));

jest.mock("/opt/sns", () => ({
  snsPublishCommand: jest.fn(),
  snsPublishSend: jest.fn(),
}), { virtual: true });

jest.mock("../../lib/handlers/emailDispatch/utils", () => ({
  sendConfirmationEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));

jest.mock("../../src/handlers/users/methods", () => ({
  getUserInfoByUserName: jest.fn(),
  getUserInfoBySub: jest.fn(),
}));

// The activities and productDates modules are required by methods.js but the
// cancellation-email function doesn't touch them.
jest.mock("../../src/handlers/activities/methods", () => ({
  getActivityByActivityId: jest.fn(),
  getActivitiesByCollectionId: jest.fn(),
}));
jest.mock("../../src/common/data-utils", () => ({
  getAndAttachNestedProperties: jest.fn(),
  quickApiPutHandler: jest.fn(),
  quickApiUpdateHandler: jest.fn(),
}));
jest.mock("../../src/handlers/productDates/methods", () => ({
  fetchProductDates: jest.fn(),
}));
jest.mock("@aws-sdk/util-dynamodb", () => ({
  unmarshall: jest.fn((x) => x),
}));

const { sendBookingCancellationEmail } = require("../../src/handlers/bookings/methods");
const { getUserInfoBySub } = require("../../src/handlers/users/methods");
const { sendCancellationEmail } = require("../../lib/handlers/emailDispatch/utils");
const { logger } = require("/opt/base");

const SUB = "11111111-2222-3333-4444-555555555555";

const baseEmailParams = {
  booking: { bookingId: "BK-1", displayName: "Day-use pass" },
  customer: { firstName: "Jane", lastName: "Doe" },
  location: { parkName: "Test Park" },
  branding: { contactEmail: "info@bcparks.ca" },
};

function cognitoUser({ email = "jane@example.com", verified = "true" } = {}) {
  return {
    Attributes: [
      { Name: "email", Value: email },
      { Name: "email_verified", Value: verified },
    ],
  };
}

describe("sendBookingCancellationEmail", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendCancellationEmail.mockResolvedValue({ messageId: "msg-1" });
  });

  it("queues the email for a verified, sub-resolved recipient", async () => {
    getUserInfoBySub.mockResolvedValue(cognitoUser());

    const result = await sendBookingCancellationEmail(baseEmailParams, SUB);

    expect(getUserInfoBySub).toHaveBeenCalledWith(SUB, "public");
    expect(sendCancellationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        customerData: expect.objectContaining({ email: "jane@example.com" }),
        bookingData: baseEmailParams.booking,
      })
    );
    expect(result).toEqual({ messageId: "msg-1" });
  });

  it("skips and logs ERROR when email_verified is false", async () => {
    getUserInfoBySub.mockResolvedValue(cognitoUser({ verified: "false" }));

    const result = await sendBookingCancellationEmail(baseEmailParams, SUB);

    expect(sendCancellationEmail).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Skipped cancellation email - email not verified",
      expect.objectContaining({ sub: SUB, bookingId: "BK-1" })
    );
    expect(result).toBeNull();
  });

  it("skips and warns when the Cognito record has no email attribute", async () => {
    getUserInfoBySub.mockResolvedValue({ Attributes: [] });

    const result = await sendBookingCancellationEmail(baseEmailParams, SUB);

    expect(sendCancellationEmail).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "Cannot send cancellation email - no email address on Cognito user",
      expect.objectContaining({ sub: SUB, bookingId: "BK-1" })
    );
    expect(result).toBeNull();
  });

  it("skips when the sub is missing", async () => {
    const result = await sendBookingCancellationEmail(baseEmailParams, null);

    expect(getUserInfoBySub).not.toHaveBeenCalled();
    expect(sendCancellationEmail).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("skips when emailParams.booking is missing", async () => {
    const result = await sendBookingCancellationEmail({}, SUB);

    expect(getUserInfoBySub).not.toHaveBeenCalled();
    expect(sendCancellationEmail).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("swallows errors from getUserInfoBySub and returns null", async () => {
    getUserInfoBySub.mockRejectedValue(new Error("Cognito down"));

    const result = await sendBookingCancellationEmail(baseEmailParams, SUB);

    expect(sendCancellationEmail).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to queue booking cancellation email",
      expect.objectContaining({ bookingId: "BK-1" })
    );
    expect(result).toBeNull();
  });
});
