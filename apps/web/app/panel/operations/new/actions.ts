"use server";

import { createHash, randomBytes } from "node:crypto";
import { normalizeBrazilPhone } from "@post-lead/core";
import { operations, people, type BusinessHoursSettings } from "@post-lead/db";
import { z } from "zod";
import { agencyIdsFor, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";

export type NewOperationState =
  | { status: "idle" }
  | { status: "error"; message: string; values: Record<string, string> }
  | { status: "created"; operationId: string; intakeKey: string };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const Form = z.object({
  agencyId: z.uuid(),
  name: z.string().trim().min(2, "Dê um nome ao cliente.").max(120),
  mode: z.enum(["team", "solo"]),
  phoneNumberId: z.string().trim().max(64),
  metaPageId: z.string().trim().max(64),
  leadAdsDisclaimerConsent: z.boolean(),
  firstResponseMinutes: z.coerce.number().int().min(1).max(240),
  staleDays: z.coerce.number().int().min(1).max(30),
  firstContactTemplate: z.string().trim().regex(/^[a-z0-9_]+$/, "Nome de modelo: só letras minúsculas, números e _."),
  followUps: z.string(),
  outOfHoursMessage: z.string().trim().max(1000),
  weekdayStart: z.string().regex(TIME),
  weekdayEnd: z.string().regex(TIME),
  saturdayStart: z.string(),
  saturdayEnd: z.string(),
  people: z.string(),
});

function parseFollowUps(text: string) {
  const steps: { afterMinutes: number; template: string }[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const match = line.match(/^(\d+)\s+([a-z0-9_]+)$/);
    if (!match) throw new Error(`Retorno inválido: "${line}". Use "minutos nome_do_modelo".`);
    steps.push({ afterMinutes: Number(match[1]), template: match[2]! });
  }
  return steps.sort((a, b) => a.afterMinutes - b.afterMinutes);
}

function parsePeople(text: string) {
  const list: { name: string; whatsappNumber: string; role: "seller" | "manager" }[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, phone, role] = line.split(";").map((p) => p?.trim() ?? "");
    const number = phone ? normalizeBrazilPhone(phone) : null;
    if (!name || !number) throw new Error(`Pessoa inválida: "${line}". Use "Nome; telefone; vendedor ou gestor".`);
    const normalizedRole = role?.toLowerCase().startsWith("g") ? "manager" : "seller";
    list.push({ name, whatsappNumber: number, role: normalizedRole });
  }
  return list;
}

export async function createOperation(_prev: NewOperationState, formData: FormData): Promise<NewOperationState> {
  const user = await requireUser();
  const value = (key: string) => String(formData.get(key) ?? "");
  // React resets the form after an action; sending the values back keeps what was typed.
  const values = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
  const fail = (message: string): NewOperationState => ({ status: "error", message, values });

  const parsed = Form.safeParse({
    agencyId: value("agencyId"),
    name: value("name"),
    mode: value("mode"),
    phoneNumberId: value("phoneNumberId"),
    metaPageId: value("metaPageId"),
    leadAdsDisclaimerConsent: formData.get("leadAdsDisclaimerConsent") === "on",
    firstResponseMinutes: value("firstResponseMinutes"),
    staleDays: value("staleDays"),
    firstContactTemplate: value("firstContactTemplate"),
    followUps: value("followUps"),
    outOfHoursMessage: value("outOfHoursMessage"),
    weekdayStart: value("weekdayStart"),
    weekdayEnd: value("weekdayEnd"),
    saturdayStart: value("saturdayStart"),
    saturdayEnd: value("saturdayEnd"),
    people: value("people"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Confira os campos.");
  }
  const data = parsed.data;

  if (!(await agencyIdsFor(user.id)).includes(data.agencyId)) {
    return fail("Você não tem acesso a essa agência.");
  }

  let followUps;
  let team;
  try {
    followUps = parseFollowUps(data.followUps);
    team = parsePeople(data.people);
  } catch (error) {
    return fail((error as Error).message);
  }
  if (team.length === 0) return fail("Cadastre pelo menos uma pessoa para receber os avisos.");
  if (data.mode === "team" && !team.some((p) => p.role === "seller")) {
    return fail("No modo equipe, cadastre pelo menos um vendedor.");
  }

  const hasSaturday = TIME.test(data.saturdayStart) && TIME.test(data.saturdayEnd);
  const weekday: [string, string] = [data.weekdayStart, data.weekdayEnd];
  const businessHours: BusinessHoursSettings = {
    timezone: "America/Sao_Paulo",
    days: {
      mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday,
      ...(hasSaturday ? { sat: [data.saturdayStart, data.saturdayEnd] as [string, string] } : {}),
    },
  };

  const intakeKey = randomBytes(24).toString("base64url");

  try {
    const operationId = await getDb().transaction(async (tx) => {
      const [operation] = await tx
        .insert(operations)
        .values({
          agencyId: data.agencyId,
          name: data.name,
          mode: data.mode,
          phoneNumberId: data.phoneNumberId || null,
          metaPageId: data.metaPageId || null,
          leadAdsDisclaimerConsent: data.leadAdsDisclaimerConsent,
          firstResponseMinutes: data.firstResponseMinutes,
          staleDays: data.staleDays,
          intakeKeyHash: createHash("sha256").update(intakeKey).digest("hex"),
          businessHours,
          cadence: {
            firstContactTemplate: data.firstContactTemplate,
            followUps,
            ...(data.outOfHoursMessage ? { outOfHoursMessage: data.outOfHoursMessage } : {}),
          },
        })
        .returning({ id: operations.id });
      await tx.insert(people).values(team.map((p) => ({ ...p, operationId: operation!.id })));
      return operation!.id;
    });
    return { status: "created", operationId, intakeKey };
  } catch (error) {
    const message = String((error as Error).message ?? "");
    if (message.includes("phone_number_id") || message.includes("meta_page_id") || message.includes("unique")) {
      return fail("Esse número do WhatsApp ou essa página já estão ligados a outro cliente.");
    }
    throw error;
  }
}
