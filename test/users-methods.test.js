"use strict";

jest.mock("/opt/cognito", () => ({
  adminGetUser: jest.fn(),
  listUsers: jest.fn(),
}), { virtual: true });

jest.mock("/opt/base", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("/opt/dynamodb", () => ({
  getOne: jest.fn(),
}));

const { getUserInfoBySub } = require("../src/handlers/users/methods");
const { adminGetUser, listUsers } = require("/opt/cognito");
const { getOne } = require("/opt/dynamodb");

const VALID_SUB = "11111111-2222-3333-4444-555555555555";

describe("getUserInfoBySub", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOne.mockResolvedValue({ PUBLIC_USER_POOL_ID: "pool-pub" });
  });

  it("rejects a non-UUID sub before calling Cognito", async () => {
    await expect(getUserInfoBySub("not-a-uuid")).rejects.toThrow(
      "Invalid sub format"
    );
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("rejects an empty sub", async () => {
    await expect(getUserInfoBySub("")).rejects.toThrow("Invalid sub format");
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("rejects a sub containing quotes (filter-injection attempt)", async () => {
    await expect(
      getUserInfoBySub('11111111-2222-3333-4444-555555555555"')
    ).rejects.toThrow("Invalid sub format");
    expect(listUsers).not.toHaveBeenCalled();
  });

  // The layer wraps a Cognito error as an Exception with the SDK error as `cause`.
  const cognitoFailure = (name, code = null) =>
    Object.assign(new Error("Failed to get user"), { code, cause: { name } });
  const cognitoUser = (sub) => ({
    Username: "jane",
    UserAttributes: [{ Name: "sub", Value: sub }, { Name: "email", Value: "jane@example.com" }],
  });

  it("gets the user by the token's username and returns the ListUsers shape", async () => {
    adminGetUser.mockResolvedValue(cognitoUser(VALID_SUB));

    const result = await getUserInfoBySub(VALID_SUB, "public", "jane");

    expect(getOne).toHaveBeenCalledWith("config", "public");
    expect(adminGetUser).toHaveBeenCalledWith("pool-pub", "jane");
    expect(listUsers).not.toHaveBeenCalled();
    expect(result.Attributes).toEqual([
      { Name: "sub", Value: VALID_SUB },
      { Name: "email", Value: "jane@example.com" },
    ]);
  });

  it("gets the user by sub when the caller has no username", async () => {
    adminGetUser.mockResolvedValue(cognitoUser(VALID_SUB));

    const result = await getUserInfoBySub(VALID_SUB);

    expect(adminGetUser).toHaveBeenCalledWith("pool-pub", VALID_SUB);
    expect(listUsers).not.toHaveBeenCalled();
    expect(result.Username).toBe("jane");
  });

  it("falls back to ListUsers by sub when AdminGetUser finds no user", async () => {
    adminGetUser.mockRejectedValue(cognitoFailure("UserNotFoundException"));
    listUsers.mockResolvedValue([{ Username: "bcsc_abc", Attributes: [] }]);

    const result = await getUserInfoBySub(VALID_SUB);

    expect(listUsers).toHaveBeenCalledWith("pool-pub", 1, undefined, `sub = "${VALID_SUB}"`);
    expect(result).toEqual({ Username: "bcsc_abc", Attributes: [] });
  });

  it("does not trust a username that names another account", async () => {
    adminGetUser.mockResolvedValue(cognitoUser("99999999-2222-3333-4444-555555555555"));
    listUsers.mockResolvedValue([{ Username: "u", Attributes: [] }]);

    const result = await getUserInfoBySub(VALID_SUB, "public", "someone-else");

    expect(listUsers).toHaveBeenCalledWith("pool-pub", 1, undefined, `sub = "${VALID_SUB}"`);
    expect(result).toEqual({ Username: "u", Attributes: [] });
  });

  it("returns null when neither call finds the user", async () => {
    adminGetUser.mockRejectedValue(cognitoFailure("UserNotFoundException"));
    listUsers.mockResolvedValue([]);
    const result = await getUserInfoBySub(VALID_SUB);
    expect(result).toBeNull();
  });

  it("rethrows a throttle as the 503 without falling back to ListUsers", async () => {
    adminGetUser.mockRejectedValue(cognitoFailure("TooManyRequestsException", 503));

    await expect(getUserInfoBySub(VALID_SUB)).rejects.toMatchObject({ code: 503 });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("hides any other Cognito failure behind a generic error", async () => {
    adminGetUser.mockRejectedValue(cognitoFailure("NotAuthorizedException"));

    const error = await getUserInfoBySub(VALID_SUB).catch((e) => e);

    expect(error.message).toBe("Error fetching user info");
    expect(error.code).toBeUndefined();
  });
});
