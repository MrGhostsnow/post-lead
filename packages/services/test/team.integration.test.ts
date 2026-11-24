/**
 * Editing a client's team against a real Postgres.
 * Skipped unless TEST_DATABASE_URL is set. Never point it at production.
 */
import { agencies, createDb, eq, events, leads, operations, people } from "@post-lead/db";
import { describe, expect, it } from "vitest";
import { syncTeam } from "../src";

const url = process.env.TEST_DATABASE_URL;
const stamp = Date.now();

describe.skipIf(!url)("syncTeam", () => {
  it("adds, updates, deactivates and hands open leads to the next seller", async () => {
    const db = createDb(url);
    const [agency] = await db.insert(agencies).values({ name: `Agência ${stamp}` }).returning();
    const [operation] = await db
      .insert(operations)
      .values({ agencyId: agency!.id, name: "Clínica", cadence: { firstReplyMessage: "Oi!", followUps: [] } })
      .returning();
    const opId = operation!.id;

    const [bia, caio, carlos] = await db
      .insert(people)
      .values([
        { operationId: opId, name: "Bia", whatsappNumber: "5577999990001", role: "seller" },
        // Caio just got a lead, so the rotation prefers someone who never did.
        { operationId: opId, name: "Caio", whatsappNumber: "5577999990002", role: "seller", lastAssignedAt: new Date() },
        { operationId: opId, name: "Carlos", whatsappNumber: "5577999990003", role: "manager" },
      ])
      .returning();

    const [openLead, wonLead] = await db
      .insert(leads)
      .values([
        { operationId: opId, contactPhone: "5577981110001", source: "form", ownerPersonId: bia!.id, stage: "in_progress" },
        { operationId: opId, contactPhone: "5577981110002", source: "form", ownerPersonId: bia!.id, stage: "won" },
      ])
      .returning();

    // Bia leaves, Caio's number comes without the ninth digit, Dani joins.
    const result = await syncTeam(db, opId, [
      { name: "Caio Souza", whatsappNumber: "557799990002", role: "seller" },
      { name: "Carlos", whatsappNumber: "5577999990003", role: "manager" },
      { name: "Dani", whatsappNumber: "5577999990004", role: "seller" },
    ]);
    expect(result).toEqual({ added: 1, updated: 1, deactivated: 1, reassigned: 1 });

    const team = await db.select().from(people).where(eq(people.operationId, opId));
    expect(team.find((p) => p.id === bia!.id)?.active).toBe(false);
    expect(team.find((p) => p.id === caio!.id)?.name).toBe("Caio Souza");
    expect(team.find((p) => p.id === carlos!.id)?.active).toBe(true);
    expect(team).toHaveLength(4);

    const [reassigned] = await db.select().from(leads).where(eq(leads.id, openLead!.id));
    const dani = team.find((p) => p.name === "Dani")!;
    // Dani never got a lead, so the rotation picks her first.
    expect(reassigned!.ownerPersonId).toBe(dani.id);
    const [closed] = await db.select().from(leads).where(eq(leads.id, wonLead!.id));
    expect(closed!.ownerPersonId).toBe(bia!.id);

    const log = await db.select().from(events).where(eq(events.leadId, openLead!.id));
    expect(log.map((e) => e.type)).toContain("lead_reassigned");

    // Adding Bia back reactivates the same person instead of creating another.
    const again = await syncTeam(db, opId, [
      ...team.filter((p) => p.active).map((p) => ({ name: p.name, whatsappNumber: p.whatsappNumber, role: p.role })),
      { name: "Bia", whatsappNumber: "5577999990001", role: "seller" as const },
    ]);
    expect(again).toEqual({ added: 0, updated: 1, deactivated: 0, reassigned: 0 });
    expect((await db.select().from(people).where(eq(people.operationId, opId))).length).toBe(4);
  });
});
