import { createCipheriv, createHash, randomBytes } from "node:crypto";

function encryptionKey(secret: string) {
  if (!secret) throw new Error("TOKEN_ENCRYPTION_KEY is required");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptToken(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
}

export function nonceHash(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
