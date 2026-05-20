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
const { listUsers } = require("/opt/cognito");
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

  it("resolves 'public' alias to the real pool id and queries by sub", async () => {
    listUsers.mockResolvedValue([{ Username: "u", Attributes: [] }]);

    const result = await getUserInfoBySub(VALID_SUB, "public");

    expect(getOne).toHaveBeenCalledWith("config", "public");
    expect(listUsers).toHaveBeenCalledWith(
      "pool-pub",
      1,
      undefined,
      `sub = "${VALID_SUB}"`
    );
    expect(result).toEqual({ Username: "u", Attributes: [] });
  });

  it("returns null when no users match the filter", async () => {
    listUsers.mockResolvedValue([]);
    const result = await getUserInfoBySub(VALID_SUB);
    expect(result).toBeNull();
  });
});
