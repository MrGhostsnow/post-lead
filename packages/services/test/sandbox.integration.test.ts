import { agencies, and, createDb, eq, leads, operations, people, sandboxMessages } from "@post-lead/db";
import { describe, expect, it } from "vitest";
import { buttonPayload, createSandboxWhatsApp, processPendingWebhooks, runDueActions, simulateInbound } from "../src";

const url = process.env.TEST_DATABASE_URL;
const stamp = Date.now();

describe.skipIf(!url)("sandbox mode", () => {
  const db = createDb(url);
  const TOOL = `tool-sbx-${stamp}`;
  const ctx = { db, whatsapp: createSandboxWhatsApp(db), toolPhoneNumberId: TOOL };
  const apply = () => processPendingWebhooks(db, { toolPhoneNumberId: TOOL });

  it("records what would be sent and lets the panel play the person's taps", async () => {
    const pn = `pn-sbx-${stamp}`;
    const [agency] = await db.insert(agencies).values({ name: "Agência sandbox" }).returning();
    const [operation] = await db
      .insert(operations)
      .values({
        agencyId: agency!.id,
        name: "Sandbox",
        phoneNumberId: pn,
        cadence: { firstReplyMessage: "Oi! Já já alguém te responde.", followUps: [] },
      })
      .returning();
    await db.insert(people).values({ operationId: operation!.id, name: "Bia", whatsappNumber: "5577911117777", role: "seller" });

    // A simulated lead writes to the client's number.
    await simulateInbound(db, { phoneNumberId: pn, from: "5577981117777", name: "Ana", text: "Oi, quero saber o preço" });
    await apply();
    const [lead] = await db.select().from(leads).where(eq(leads.operationId, operation!.id));
    expect(lead?.contactPhone).toBe("5577981117777");

    // Nothing goes to Meta: the first reply and the seller's notice are stored.
    await runDueActions(ctx);
    const reply = await db.select().from(sandboxMessages).where(and(eq(sandboxMessages.phoneNumberId, pn), eq(sandboxMessages.to, "5577981117777")));
    expect(reply.map((m) => m.body)).toEqual(["Oi! Já já alguém te responde."]);
    const [notice] = await db.select().from(sandboxMessages).where(and(eq(sandboxMessages.phoneNumberId, TOOL), eq(sandboxMessages.to, "5577911117777")));
    expect(notice).toMatchObject({ kind: "template", template: "notify_new_lead" });
    expect(notice?.body).toContain("Novo lead: Ana");
    expect(notice?.buttons).toEqual([{ id: buttonPayload("not_lead", lead!.id), title: "Não é lead" }]);

    // Bia taps "Não é lead" in the panel: the lead is gone for good.
    await simulateInbound(db, { phoneNumberId: TOOL, from: "5577911117777", buttonId: notice!.buttons[0]!.id, buttonTitle: "Não é lead" });
    await apply();
    expect(await db.select().from(leads).where(eq(leads.operationId, operation!.id))).toHaveLength(0);
  }, 30_000);
});
