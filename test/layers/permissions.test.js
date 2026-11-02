"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const mockGetSigningKey = jest.fn();
// jwks-rsa fetches keys over the network and is not installed at the root, so it is virtual.
jest.mock("jwks-rsa", () => jest.fn(() => ({ getSigningKey: (...args) => mockGetSigningKey(...args) })), { virtual: true });

const jwksClient = require("jwks-rsa");
const { decodeJWT, requireAdmin, resolvePermissions } = require("../../src/layers/base/permissions");

const ISSUER = "https://sso.test/realms/bcparks";
const JWKS = "https://sso.test/certs";
const signer = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const stranger = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = (key) => key.export({ type: "spki", format: "pem" });

const claims = { iss: ISSUER, email: "a@x.test", resource_access: { "data-register": { roles: ["sysadmin"] } } };
const sign = (payload = claims, key = signer.privateKey) =>
  jwt.sign(payload, key, { algorithm: "RS256", keyid: "kid-1", noTimestamp: true });
const bearer = (token) => ({ headers: { Authorization: `Bearer ${token}` } });
const INVALID = { decoded: false, data: null };

beforeEach(() => {
  mockGetSigningKey.mockReset();
  mockGetSigningKey.mockImplementation((kid, cb) => cb(null, { publicKey: pem(signer.publicKey) }));
});

describe("decodeJWT", () => {
  it("returns the claims of a token signed by the issuer's key", async () => {
    await expect(decodeJWT(bearer(sign()), ISSUER, JWKS)).resolves.toEqual({ decoded: true, data: claims });
    expect(jwksClient).toHaveBeenCalledWith({ strictSsl: true, jwksUri: JWKS });
    expect(mockGetSigningKey.mock.calls[0][0]).toBe("kid-1");
  });

  it("accepts an rsaPublicKey from the key set", async () => {
    mockGetSigningKey.mockImplementation((kid, cb) => cb(null, { rsaPublicKey: pem(signer.publicKey) }));

    await expect(decodeJWT(bearer(sign()), ISSUER, JWKS)).resolves.toMatchObject({ decoded: true });
  });

  it.each([
    ["a header without Bearer", { headers: { Authorization: sign() } }],
    ["no Authorization header", { headers: {} }],
    ["a different issuer", bearer(sign({ ...claims, iss: "https://evil.test" }))],
    ["a signature from another key", bearer(sign(claims, stranger.privateKey))],
  ])("rejects %s", async (_label, event) => {
    await expect(decodeJWT(event, ISSUER, JWKS)).resolves.toEqual(INVALID);
  });

  it("rejects a token when the signing key cannot be fetched", async () => {
    mockGetSigningKey.mockImplementation((kid, cb) => cb(new Error("SigningKeyNotFoundError")));

    await expect(decodeJWT(bearer(sign()), ISSUER, JWKS)).resolves.toEqual(INVALID);
  });
});

describe("resolvePermissions", () => {
  it("marks a sysadmin as an authenticated admin", () => {
    expect(resolvePermissions({ data: claims })).toEqual({
      roles: ["sysadmin"], isAdmin: true, isAuthenticated: true, email: "a@x.test",
    });
  });

  it("authenticates other data-register roles without admin", () => {
    const data = { email: "b@x.test", resource_access: { "data-register": { roles: ["viewer"] } } };

    expect(resolvePermissions({ data })).toEqual({ roles: ["viewer"], isAdmin: false, isAuthenticated: true, email: "b@x.test" });
  });

  it("treats a token without data-register roles as public", () => {
    expect(resolvePermissions({ data: { email: "c@x.test" } })).toEqual({
      roles: ["public"], isAdmin: false, isAuthenticated: false, email: "c@x.test",
    });
  });
});

describe("requireAdmin", () => {
  const event = (isAdmin) => ({ requestContext: { authorizer: { isAdmin } } });

  it("passes an admin", () => {
    expect(requireAdmin(event("true"))).toBe(true);
  });

  it("refuses a non-admin with a 403", () => {
    expect(() => requireAdmin(event("false"))).toThrow(expect.objectContaining({
      code: 403,
      message: "User does not have the permissions to perform this action.",
      error: "Unauthorized to perform this function.",
    }));
  });
});
