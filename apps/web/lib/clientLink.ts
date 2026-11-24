import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { requiredEnv } from "./server";

/**
 * Read-only link for a client: /c/<operationId>.<signature>.
 * The signature covers the operation's link version, so bumping
 * operations.client_link_version revokes every link issued before.
 */

function sign(operationId: string, version: number): string {
  return createHmac("sha256", requiredEnv("CLIENT_LINK_SECRET"))
    .update(`${operationId}:${version}`)
    .digest("base64url")
    .slice(0, 32);
}

export function clientLinkToken(operationId: string, version: number): string {
  return `${operationId}.${sign(operationId, version)}`;
}

export function parseClientLinkToken(token: string): { operationId: string; signature: string } | null {
  const [operationId, signature] = token.split(".");
  if (!operationId || !signature) return null;
  return { operationId, signature };
}

export function isValidClientLink(operationId: string, version: number, signature: string): boolean {
  const expected = Buffer.from(sign(operationId, version));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
