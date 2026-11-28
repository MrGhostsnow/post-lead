import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets kept in the database (clients' WhatsApp tokens).
 * The key is 32 random bytes, base64, in TOKEN_ENCRYPTION_KEY; generate one with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */
function key(base64Key: string): Buffer {
  const k = Buffer.from(base64Key, "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64");
  return k;
}

export function encryptSecret(plain: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(base64Key), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptSecret(sealed: string, base64Key: string): string {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(base64Key), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
