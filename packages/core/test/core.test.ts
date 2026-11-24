import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  brazilPhoneVariants,
  canSendFreeform,
  isWithinBusinessHours,
  normalizeBrazilPhone,
  parseWhatsAppWebhook,
  pickNextOwner,
  planFollowUps,
  planResponseEscalation,
  verifyMetaSignature,
  type CadenceConfig,
} from "../src";

describe("normalizeBrazilPhone", () => {
  it("accepts common input formats", () => {
    expect(normalizeBrazilPhone("(77) 99999-8888")).toBe("5577999998888");
    expect(normalizeBrazilPhone("+55 77 99999 8888")).toBe("5577999998888");
    expect(normalizeBrazilPhone("7733334444")).toBe("557733334444");
  });

  it("rejects numbers that cannot be Brazilian", () => {
    expect(normalizeBrazilPhone("12345")).toBeNull();
  });
});

describe("brazilPhoneVariants", () => {
  it("returns the number with and without the ninth digit", () => {
    expect(brazilPhoneVariants("5577999998888")).toEqual(["5577999998888", "557799998888"]);
    expect(brazilPhoneVariants("557799998888")).toEqual(["557799998888", "5577999998888"]);
  });

  it("leaves landlines alone", () => {
    expect(brazilPhoneVariants("557733334444")).toEqual(["557733334444"]);
  });
});

describe("verifyMetaSignature", () => {
  const secret = "app-secret";
  const body = JSON.stringify({ hello: "world" });
  const valid = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correct signature", () => {
    expect(verifyMetaSignature(body, valid, secret)).toBe(true);
  });

  it("rejects a tampered body or missing header", () => {
    expect(verifyMetaSignature(body + " ", valid, secret)).toBe(false);
    expect(verifyMetaSignature(body, null, secret)).toBe(false);
  });
});

describe("parseWhatsAppWebhook", () => {
  const base = (field: string, value: Record<string, unknown>) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "waba", changes: [{ field, value: { metadata: { phone_number_id: "pn1" }, ...value } }] }],
  });

  it("parses an inbound text message with the contact name", () => {
    const events = parseWhatsAppWebhook(
      base("messages", {
        contacts: [{ wa_id: "5577999998888", profile: { name: "Ana" } }],
        messages: [{ from: "5577999998888", id: "wamid.1", timestamp: "1700000000", type: "text", text: { body: "Oi" } }],
      }),
    );
    expect(events).toEqual([
      expect.objectContaining({ kind: "inbound_message", from: "5577999998888", contactName: "Ana", text: "Oi" }),
    ]);
  });

  it("parses a tapped quick-reply button", () => {
    const [event] = parseWhatsAppWebhook(
      base("messages", {
        messages: [{ from: "5577", id: "wamid.2", timestamp: "1700000000", type: "button", button: { payload: "won:lead-1", text: "Ganhou" } }],
      }),
    );
    expect(event).toMatchObject({ kind: "inbound_message", buttonPayload: "won:lead-1" });
  });

  it("parses statuses and business app echoes", () => {
    const statuses = parseWhatsAppWebhook(base("messages", { statuses: [{ id: "wamid.3", status: "delivered", timestamp: "1700000000", recipient_id: "5577" }] }));
    expect(statuses[0]).toMatchObject({ kind: "status", status: "delivered" });

    const echoes = parseWhatsAppWebhook(
      base("smb_message_echoes", { message_echoes: [{ from: "pn", to: "5577", id: "wamid.4", timestamp: "1700000000", type: "text", text: { body: "Olá" } }] }),
    );
    expect(echoes[0]).toMatchObject({ kind: "business_echo", to: "5577", text: "Olá" });
  });

  it("ignores payloads from other products", () => {
    expect(parseWhatsAppWebhook({ object: "page" })).toEqual([]);
  });
});

describe("pickNextOwner", () => {
  it("chooses the active seller who waited longest", () => {
    const owner = pickNextOwner([
      { id: "a", active: true, lastAssignedAt: new Date("2026-11-19T10:00:00Z") },
      { id: "b", active: true, lastAssignedAt: new Date("2026-11-19T09:00:00Z") },
      { id: "c", active: false, lastAssignedAt: null },
    ]);
    expect(owner).toBe("b");
  });

  it("puts someone who never received a lead first", () => {
    expect(
      pickNextOwner([
        { id: "a", active: true, lastAssignedAt: new Date() },
        { id: "z", active: true, lastAssignedAt: null },
      ]),
    ).toBe("z");
  });

  it("returns null when nobody is active", () => {
    expect(pickNextOwner([{ id: "a", active: false, lastAssignedAt: null }])).toBeNull();
  });
});

describe("cadence", () => {
  const config: CadenceConfig = {
    followUps: [
      { afterMinutes: 60, template: "follow_up_1" },
      { afterMinutes: 24 * 60, template: "follow_up_2" },
    ],
    firstResponseMinutes: 5,
    staleDays: 3,
  };
  const t0 = new Date("2026-11-19T12:00:00Z");

  it("schedules follow-ups relative to the first contact", () => {
    const plan = planFollowUps(t0, config);
    expect(plan.map((p) => p.runAt.toISOString())).toEqual([
      "2026-11-19T13:00:00.000Z",
      "2026-11-20T12:00:00.000Z",
    ]);
  });

  it("escalates to the owner at X and the manager at 2X", () => {
    const [reminder, alert] = planResponseEscalation(t0, config);
    expect(reminder?.runAt.toISOString()).toBe("2026-11-19T12:05:00.000Z");
    expect(alert?.runAt.toISOString()).toBe("2026-11-19T12:10:00.000Z");
  });

  it("allows free-form text only inside the 24-hour window", () => {
    expect(canSendFreeform(null, t0)).toBe(false);
    expect(canSendFreeform(new Date(t0.getTime() - 23 * 3600_000), t0)).toBe(true);
    expect(canSendFreeform(new Date(t0.getTime() - 25 * 3600_000), t0)).toBe(false);
  });

  it("checks business hours in the operation's timezone", () => {
    const hours = { timezone: "America/Sao_Paulo", days: { thu: ["08:00", "18:00"] as [string, string] } };
    // 2026-11-19 is a Thursday; 12:00 UTC is 09:00 in São Paulo.
    expect(isWithinBusinessHours(t0, hours)).toBe(true);
    // 23:00 UTC is 20:00 in São Paulo.
    expect(isWithinBusinessHours(new Date("2026-11-19T23:00:00Z"), hours)).toBe(false);
  });
});
