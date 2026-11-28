import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWhatsAppClient, decryptSecret, encryptSecret } from "../src";

const key = randomBytes(32).toString("base64");

describe("secretBox", () => {
  it("round-trips and never repeats the ciphertext", () => {
    const a = encryptSecret("EAAG-token", key);
    expect(decryptSecret(a, key)).toBe("EAAG-token");
    expect(encryptSecret("EAAG-token", key)).not.toBe(a);
    expect(a).not.toContain("EAAG");
  });

  it("refuses a tampered value or another key", () => {
    const sealed = encryptSecret("EAAG-token", key);
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
    expect(() => decryptSecret(sealed, randomBytes(32).toString("base64"))).toThrow();
    expect(() => encryptSecret("x", "short")).toThrow("32 bytes");
  });
});

describe("WhatsApp client with a token per number", () => {
  it("asks the resolver for each sending number", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: { headers: Record<string, string> }) => {
      seen.push(`${url.split("/")[4]} ${init.headers.Authorization}`);
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: "wamid.1" }] }) };
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({
      apiVersion: "v25.0",
      accessToken: async (id) => (id === "client-pn" ? "client-token" : "tool-token"),
      fetchImpl,
    });
    await client.sendText("client-pn", "5577999990000", "oi");
    await client.sendText("tool-pn", "5577999990000", "oi");
    expect(seen).toEqual(["client-pn Bearer client-token", "tool-pn Bearer tool-token"]);
  });
});
