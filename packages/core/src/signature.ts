import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the X-Hub-Signature-256 header Meta sends with every webhook.
 * The HMAC must be computed over the raw request body, before any JSON parsing.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const received = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();

  return received.length === expected.length && timingSafeEqual(received, expected);
}
