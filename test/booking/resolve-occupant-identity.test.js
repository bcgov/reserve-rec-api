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

const { resolveAuthenticatedOccupantIdentity } = require("../../src/handlers/bookings/methods");
const { getUserInfoBySub } = require("../../src/handlers/users/methods");

const SUB = "11111111-2222-3333-4444-555555555555";

function cognitoAttrs(map) {
  return {
    Attributes: Object.entries(map).map(([Name, Value]) => ({ Name, Value })),
  };
}

describe("resolveAuthenticatedOccupantIdentity", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns identity fields from Cognito attributes", async () => {
    getUserInfoBySub.mockResolvedValue(cognitoAttrs({
      given_name: "Jane",
      family_name: "Doe",
      email: "jane@example.com",
      phone_number: "+12345550000",
    }));

    const id = await resolveAuthenticatedOccupantIdentity(SUB);

    expect(getUserInfoBySub).toHaveBeenCalledWith(SUB, "public");
    expect(id).toEqual({
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      mobilePhone: "+12345550000",
    });
  });

  it("prefers custom:mobilePhone over phone_number when both present", async () => {
    getUserInfoBySub.mockResolvedValue(cognitoAttrs({
      "custom:mobilePhone": "+19999999999",
      phone_number: "+10000000000",
    }));

    const id = await resolveAuthenticatedOccupantIdentity(SUB);

    expect(id.mobilePhone).toBe("+19999999999");
  });

  it("returns empty strings for attributes Cognito does not have", async () => {
    getUserInfoBySub.mockResolvedValue(cognitoAttrs({
      email: "jane@example.com",
    }));

    const id = await resolveAuthenticatedOccupantIdentity(SUB);

    expect(id).toEqual({
      firstName: "",
      lastName: "",
      email: "jane@example.com",
      mobilePhone: "",
    });
  });

  it("returns null when sub is missing", async () => {
    const id = await resolveAuthenticatedOccupantIdentity(null);
    expect(getUserInfoBySub).not.toHaveBeenCalled();
    expect(id).toBeNull();
  });

  it("propagates Cognito errors so callers can fail closed", async () => {
    getUserInfoBySub.mockRejectedValue(new Error("Cognito down"));
    await expect(resolveAuthenticatedOccupantIdentity(SUB)).rejects.toThrow("Cognito down");
  });
});
