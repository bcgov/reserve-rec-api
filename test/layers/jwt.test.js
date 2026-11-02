"use strict";

const crypto = require("crypto");

const mockKmsSend = jest.fn();
// client-kms is not installed in the root workspace, so the module is virtual.
jest.mock("@aws-sdk/client-kms", () => ({
  KMSClient: jest.fn(() => ({ send: (...args) => mockKmsSend(...args) })),
  GetPublicKeyCommand: class GetPublicKeyCommand { constructor(input) { this.input = input; } },
  DecryptCommand: class DecryptCommand { constructor(input) { this.input = input; } },
}), { virtual: true });

const { JWTManager } = require("../../src/layers/base/jwt");

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (buf) => Buffer.from(buf).toString("base64url");

// KMS fake: hands out the real public key and RSA-OAEP-256 decrypts with the private one.
function fakeKms() {
  mockKmsSend.mockImplementation(async (command) => {
    if (command.constructor.name === "GetPublicKeyCommand") {
      return { PublicKey: new Uint8Array(publicKey.export({ type: "spki", format: "der" })) };
    }
    const plain = crypto.privateDecrypt(
      { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
      command.input.CiphertextBlob
    );
    return { Plaintext: new Uint8Array(plain) };
  });
}

const wrapKey = (cek) => crypto.publicEncrypt(
  { key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
  cek
);

// RFC 7518 5.2: MAC key is the first half of the CEK, AES key the second.
function cbcJwe(enc, plaintext) {
  const [bits, hash] = enc === "A256CBC-HS512" ? [256, "sha512"] : [128, "sha256"];
  const half = bits / 8;
  const cek = crypto.randomBytes(half * 2);
  const iv = crypto.randomBytes(16);
  const header = b64u(JSON.stringify({ alg: "RSA-OAEP-256", enc }));
  const cipher = crypto.createCipheriv(`aes-${bits}-cbc`, cek.subarray(half), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const al = Buffer.alloc(8);
  al.writeBigUInt64BE(BigInt(header.length * 8));
  const tag = crypto.createHmac(hash, cek.subarray(0, half))
    .update(Buffer.concat([Buffer.from(header), iv, ciphertext, al])).digest().subarray(0, half);
  return [header, b64u(wrapKey(cek)), b64u(iv), b64u(ciphertext), b64u(tag)].join(".");
}

function jweWithCek(enc, cek) {
  const header = b64u(JSON.stringify({ alg: "RSA-OAEP-256", enc }));
  return [header, b64u(wrapKey(cek)), b64u(crypto.randomBytes(16)), b64u(Buffer.alloc(16)), b64u(Buffer.alloc(16))].join(".");
}

let manager;
beforeEach(() => {
  mockKmsSend.mockReset();
  process.env.BCSC_KEY_ID = "alias/bcsc";
  manager = new JWTManager();
});
afterEach(() => delete process.env.BCSC_KEY_ID);

describe("JWTManager keys", () => {
  it("returns the KMS public key as PEM and fetches it once", async () => {
    fakeKms();

    const pem = await manager.getPublicKey();
    await manager.getPublicKey();

    expect(pem).toBe(publicKey.export({ type: "spki", format: "pem" }).trim());
    expect(mockKmsSend).toHaveBeenCalledTimes(1);
    expect(mockKmsSend.mock.calls[0][0].input).toEqual({ KeyId: "alias/bcsc" });
  });

  it("publishes the key's modulus in the JWKS", async () => {
    fakeKms();
    const asInt = (n) => BigInt(`0x${Buffer.from(n, "base64url").toString("hex")}`);

    const { keys: [key, ...rest] } = await manager.generateJWKS();

    expect(rest).toEqual([]);
    expect(key).toMatchObject({ e: "AQAB", kty: "RSA", use: "enc", alg: "RS256", kid: "bcscencryption" });
    expect(key.n).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(asInt(key.n)).toBe(asInt(publicKey.export({ format: "jwk" }).n));
  });

  it("refuses to start without BCSC_KEY_ID", async () => {
    delete process.env.BCSC_KEY_ID;

    await expect(new JWTManager().getPublicKey()).rejects.toThrow("BCSC_KEY_ID environment variable not set");
    expect(mockKmsSend).not.toHaveBeenCalled();
  });

  it("reports a KMS failure", async () => {
    mockKmsSend.mockRejectedValue(new Error("AccessDeniedException"));

    await expect(manager.getPublicKey()).rejects.toThrow("KMS key retrieval failed: AccessDeniedException");
  });
});

describe("JWTManager.decryptJWE", () => {
  beforeEach(fakeKms);

  it.each(["A256CBC-HS512", "A128CBC-HS256"])("decrypts a %s token", async (enc) => {
    const token = cbcJwe(enc, "header.payload.signature");

    await expect(manager.decryptJWE(token)).resolves.toBe("header.payload.signature");
    const decrypt = mockKmsSend.mock.calls.find(([c]) => c.constructor.name === "DecryptCommand")[0];
    expect(decrypt.input).toMatchObject({ KeyId: "alias/bcsc", EncryptionAlgorithm: "RSAES_OAEP_SHA_256" });
  });

  // decryptJWE never verifies the CBC-HMAC tag, so a tampered token still decrypts.
  test.failing.each(["A256CBC-HS512", "A128CBC-HS256"])("rejects a %s token whose tag was tampered", async (enc) => {
    const parts = cbcJwe(enc, "header.payload.signature").split(".");
    parts[4] = b64u(crypto.randomBytes(Buffer.from(parts[4], "base64url").length));

    await expect(manager.decryptJWE(parts.join("."))).rejects.toThrow(/^Error during decryption: /);
  });

  it("rejects a token that is not five parts", async () => {
    await expect(manager.decryptJWE("a.b.c")).rejects.toThrow("Invalid JWE format - expected 5 parts, got 3");
  });

  it.each([
    ["A256CBC-HS512", 32, "Invalid CEK length for A256CBC-HS512: 32, expected 64"],
    ["A128CBC-HS256", 64, "Invalid CEK length for A128CBC-HS256: 64, expected 32"],
  ])("rejects a %s key of the wrong length", async (enc, length, message) => {
    await expect(manager.decryptJWE(jweWithCek(enc, crypto.randomBytes(length))))
      .rejects.toThrow(`Error during decryption: ${message}`);
  });

  it("rejects an unsupported content encryption", async () => {
    await expect(manager.decryptJWE(jweWithCek("A128GCM", crypto.randomBytes(16))))
      .rejects.toThrow("Error during decryption: Unsupported JWE encryption algorithm: A128GCM");
  });

  it("rejects an A256GCM token whose tag does not authenticate", async () => {
    await expect(manager.decryptJWE(jweWithCek("A256GCM", crypto.randomBytes(32))))
      .rejects.toThrow(/^Error during decryption: /);
  });
});
