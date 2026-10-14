"use strict";

// The Cognito layer must keep a throttle distinguishable from a refusal: the
// 07:00 release turned TooManyRequestsException into HTTP 400.

const { adminGetUser, listUsers, cognitoProviderClient } = require("../src/layers/awsUtils/cognito");

const sdkError = (name) => Object.assign(new Error(name), { name });

describe("Cognito layer errors", () => {
  let send;
  beforeEach(() => {
    send = jest.spyOn(cognitoProviderClient, "send");
  });
  afterEach(() => send.mockRestore());

  it.each(["TooManyRequestsException", "ThrottlingException", "InternalErrorException"])(
    "turns %s from AdminGetUser into a 503 with a retry hint",
    async (name) => {
      send.mockRejectedValue(sdkError(name));

      const error = await adminGetUser("pool", "jane").catch((e) => e);

      expect(error.code).toBe(503);
      expect(error.data).toEqual({ retryAfter: 2 });
      expect(error.cause.name).toBe(name);
    }
  );

  it("turns a ListUsers throttle into a 503", async () => {
    send.mockRejectedValue(sdkError("TooManyRequestsException"));

    await expect(listUsers("pool", 1)).rejects.toMatchObject({ code: 503 });
  });

  it("leaves UserNotFoundException without a status and keeps its name", async () => {
    send.mockRejectedValue(sdkError("UserNotFoundException"));

    const error = await adminGetUser("pool", "nobody").catch((e) => e);

    expect(error.code).toBeNull();
    expect(error.message).toBe("Failed to get user");
    expect(error.cause.name).toBe("UserNotFoundException");
  });

  it("keeps the wrapped error serializable when the SDK error is circular", async () => {
    const circular = sdkError("TooManyRequestsException");
    circular.$response = { req: {} };
    circular.$response.req.res = circular.$response;
    send.mockRejectedValue(circular);

    const error = await adminGetUser("pool", "jane").catch((e) => e);

    expect(() => JSON.stringify(error)).not.toThrow();
  });
});
