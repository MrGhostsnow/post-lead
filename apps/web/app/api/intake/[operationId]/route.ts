import { createHash, timingSafeEqual } from "node:crypto";
import { eq, operations } from "@post-lead/db";
import { createLead } from "@post-lead/services";
import { z } from "zod";
import { getDb } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Generic lead intake for forms and landing pages:
 * POST /api/intake/:operationId with header "x-intake-key".
 */
const LeadBody = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().min(8).max(30),
  /** Must be true for the tool to send the first WhatsApp message. */
  whatsappConsent: z.boolean(),
  campaign: z.string().max(200).optional(),
  ad: z.string().max(200).optional(),
  utm: z.record(z.string(), z.string().max(300)).optional(),
});

function sameHash(key: string, expectedHash: string) {
  const actual = createHash("sha256").update(key).digest();
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function POST(request: Request, context: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await context.params;
  if (!z.uuid().safeParse(operationId).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const db = getDb();
  const [operation] = await db
    .select({ id: operations.id, intakeKeyHash: operations.intakeKeyHash })
    .from(operations)
    .where(eq(operations.id, operationId));

  const key = request.headers.get("x-intake-key");
  if (!operation?.intakeKeyHash || !key || !sameHash(key, operation.intakeKeyHash)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = LeadBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_body", issues: parsed.error.issues }, { status: 400 });
  }

  const result = await createLead(db, {
    operationId: operation.id,
    contactName: parsed.data.name,
    phone: parsed.data.phone,
    source: "form",
    campaign: parsed.data.campaign,
    ad: parsed.data.ad,
    utm: parsed.data.utm,
    whatsappConsent: parsed.data.whatsappConsent,
  });

  if (result.status === "invalid_phone") {
    return Response.json({ error: "invalid_phone" }, { status: 422 });
  }
  return Response.json(result, { status: result.status === "created" ? 201 : 200 });
}
