import { randomBytes } from "node:crypto";
import { decryptSecret } from "@post-lead/core";
import { agencies, createDb, eq, operations } from "@post-lead/db";
import { describe, expect, it } from "vitest";
import { connectWhatsApp, createTokenResolver } from "../src";

const url = process.env.TEST_DATABASE_URL;
const stamp = Date.now();
const key = randomBytes(32).toString("base64");

/** A Graph API double: records every call and answers from a table of routes. */
function fakeGraph(numbers: { id: string; display_phone_number: string; is_on_biz_app?: boolean }[]) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string, init?: { method?: string; body?: string }) => {
    const path = input.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//, "").split("?")[0]!;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${path}${body?.sync_type ? ` ${body.sync_type}` : ""}`);
    const ok = (json: unknown) => ({ ok: true, status: 200, json: async () => json });
    if (path === "oauth/access_token") return ok({ access_token: "client-business-token" });
    if (path.endsWith("/subscribed_apps")) return ok({ success: true });
    if (path.endsWith("/phone_numbers")) return ok({ data: numbers });
    if (path.endsWith("/smb_app_data")) return ok({ request_id: "r1" });
    if (path.endsWith("/register")) return ok({ success: true });
    if (path.endsWith("/message_templates") && method === "GET") return ok({ data: [] });
    if (path.endsWith("/message_templates")) return ok({ id: "t", status: "PENDING" });
    return { ok: false, status: 404, json: async () => ({ error: { message: `unexpected ${path}` } }) };
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe.skipIf(!url)("connecting a client's WhatsApp", () => {
  const db = createDb(url);

  async function newOperation(name: string) {
    const [agency] = await db.insert(agencies).values({ name: `Agência ${name}` }).returning();
    const [op] = await db
      .insert(operations)
      .values({ agencyId: agency!.id, name, cadence: { firstReplyMessage: "Oi!", followUps: [] } })
      .returning();
    return op!;
  }

  it("keeps a WhatsApp Business app number in the app and imports contacts, history and templates", async () => {
    const op = await newOperation("Clínica coexistência");
    const graph = fakeGraph([{ id: `pn-coex-${stamp}`, display_phone_number: "+55 77 98805-6971", is_on_biz_app: true }]);
    const config = { appId: "app", appSecret: "secret", encryptionKey: key, apiVersion: "v25.0", fetchImpl: graph.fetchImpl };

    const result = await connectWhatsApp(db, config, { operationId: op.id, code: "code", wabaId: `waba-${stamp}` });

    expect(result.ok).toBe(true);
    expect(graph.calls).toEqual([
      "GET oauth/access_token",
      `POST waba-${stamp}/subscribed_apps`,
      `GET waba-${stamp}/phone_numbers`,
      `POST pn-coex-${stamp}/smb_app_data smb_app_state_sync`,
      `POST pn-coex-${stamp}/smb_app_data history`,
      `GET waba-${stamp}/message_templates`,
      `POST waba-${stamp}/message_templates`,
      `POST waba-${stamp}/message_templates`,
      `POST waba-${stamp}/message_templates`,
    ]);
    const [saved] = await db.select().from(operations).where(eq(operations.id, op.id));
    expect(saved).toMatchObject({ phoneNumberId: `pn-coex-${stamp}`, wabaId: `waba-${stamp}`, coexistence: true, displayPhone: "+55 77 98805-6971" });
    expect(saved?.historySyncRequestedAt).not.toBeNull();
    expect(saved?.accessTokenEncrypted).not.toContain("client-business-token");
    expect(decryptSecret(saved!.accessTokenEncrypted!, key)).toBe("client-business-token");

    // The worker sends from this number with the client's token, and from others with the tool's.
    const resolve = createTokenResolver(db, { fallbackToken: "tool-token", encryptionKey: key });
    expect(await resolve(`pn-coex-${stamp}`)).toBe("client-business-token");
    expect(await resolve("some-other-number")).toBe("tool-token");
  }, 30_000);

  it("registers a number that is not in the app, and refuses one another client already uses", async () => {
    const op = await newOperation("Loja API");
    const graph = fakeGraph([{ id: `pn-api-${stamp}`, display_phone_number: "+55 77 3421-0000" }]);
    const config = { appId: "app", appSecret: "secret", encryptionKey: key, apiVersion: "v25.0", fetchImpl: graph.fetchImpl };

    const result = await connectWhatsApp(db, config, { operationId: op.id, code: "code", wabaId: `waba2-${stamp}`, phoneNumberId: `pn-api-${stamp}` });
    expect(result.ok).toBe(true);
    expect(graph.calls).toContain(`POST pn-api-${stamp}/register`);
    expect(graph.calls.some((c) => c.includes("smb_app_data"))).toBe(false);

    const other = await newOperation("Outro cliente");
    const again = await connectWhatsApp(db, config, { operationId: other.id, code: "code", wabaId: `waba2-${stamp}` });
    expect(again).toMatchObject({ ok: false });
    expect(again.ok ? "" : again.message).toContain('already connected to the client "Loja API"');
  }, 30_000);
});
