import "server-only";
import { normalizeBrazilPhone } from "@post-lead/core";
import type { BusinessHoursSettings, CadenceSettings, operations, people } from "@post-lead/db";
import type { TeamMember } from "@post-lead/services";
import { z } from "zod";

/** The fields a client form sends, shared by "Novo cliente" and "Editar cliente". */
export type FormValues = Record<string, string>;

export const DEFAULT_VALUES: FormValues = {
  mode: "team",
  firstResponseMinutes: "5",
  staleDays: "3",
  firstReplyMessage: "Oi! Recebemos sua mensagem, já já alguém te responde por aqui.",
  followUps: "60 follow_up_1\n1440 follow_up_2",
  reengagementTemplate: "reengage_1",
  outOfHoursMessage:
    "Recebemos sua mensagem! Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Assim que abrirmos, alguém continua com você por aqui.",
  weekdayStart: "08:00",
  weekdayEnd: "18:00",
  saturdayStart: "",
  saturdayEnd: "",
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const TEMPLATE = /^[a-z0-9_]+$/;

const Form = z.object({
  name: z.string().trim().min(2, "Dê um nome ao cliente.").max(120),
  mode: z.enum(["team", "solo"]),
  phoneNumberId: z.string().trim().max(64),
  firstResponseMinutes: z.coerce.number().int().min(1, "O prazo para responder vai de 1 a 240 minutos.").max(240, "O prazo para responder vai de 1 a 240 minutos."),
  staleDays: z.coerce.number().int().min(1, "Conversa parada: de 1 a 30 dias.").max(30, "Conversa parada: de 1 a 30 dias."),
  firstReplyMessage: z.string().trim().min(5, "Escreva a primeira resposta ao lead.").max(1000),
  followUps: z.string(),
  reengagementTemplate: z.string().trim().refine((v) => v === "" || TEMPLATE.test(v), "Modelo de retomada: só letras minúsculas, números e _."),
  outOfHoursMessage: z.string().trim().max(1000),
  weekdayStart: z.string().regex(TIME, "Horário de abertura inválido."),
  weekdayEnd: z.string().regex(TIME, "Horário de fechamento inválido."),
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

function parsePeople(text: string): TeamMember[] {
  const list: TeamMember[] = [];
  for (const line of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const [name, phone, role] = line.split(";").map((p) => p?.trim() ?? "");
    const number = phone ? normalizeBrazilPhone(phone) : null;
    if (!name || !number) throw new Error(`Pessoa inválida: "${line}". Use "Nome; telefone; vendedor ou gestor".`);
    list.push({ name, whatsappNumber: number, role: role?.toLowerCase().startsWith("g") ? "manager" : "seller" });
  }
  return list;
}

export type OperationSettings = {
  name: string;
  mode: "team" | "solo";
  phoneNumberId: string | null;
  firstResponseMinutes: number;
  staleDays: number;
  cadence: CadenceSettings;
  businessHours: BusinessHoursSettings;
};

export type ParsedForm = { ok: true; settings: OperationSettings; team: TeamMember[] } | { ok: false; message: string };

/**
 * Validates a client form. Existing cadence fields the form does not show
 * (language, first-name variable) are kept from `previous`.
 */
export function parseOperationForm(formData: FormData, previous?: CadenceSettings): ParsedForm {
  const value = (key: string) => String(formData.get(key) ?? "");
  const parsed = Form.safeParse(Object.fromEntries(Object.keys(Form.shape).map((k) => [k, value(k)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Confira os campos." };
  const data = parsed.data;

  let followUps;
  let team;
  try {
    followUps = parseFollowUps(data.followUps);
    team = parsePeople(data.people);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  if (team.length === 0) return { ok: false, message: "Cadastre pelo menos uma pessoa para receber os avisos." };
  if (data.mode === "team" && !team.some((p) => p.role === "seller")) {
    return { ok: false, message: "No modo equipe, cadastre pelo menos um vendedor." };
  }
  const numbers = team.map((p) => p.whatsappNumber);
  if (new Set(numbers).size !== numbers.length) return { ok: false, message: "O mesmo WhatsApp aparece em duas pessoas." };

  const hasSaturday = TIME.test(data.saturdayStart) && TIME.test(data.saturdayEnd);
  const weekday: [string, string] = [data.weekdayStart, data.weekdayEnd];

  return {
    ok: true,
    team,
    settings: {
      name: data.name,
      mode: data.mode,
      phoneNumberId: data.phoneNumberId || null,
      firstResponseMinutes: data.firstResponseMinutes,
      staleDays: data.staleDays,
      cadence: {
        ...(previous?.languageCode ? { languageCode: previous.languageCode } : {}),
        ...(previous?.firstNameParam !== undefined ? { firstNameParam: previous.firstNameParam } : {}),
        firstReplyMessage: data.firstReplyMessage,
        followUps,
        ...(data.reengagementTemplate ? { reengagementTemplate: data.reengagementTemplate } : {}),
        ...(data.outOfHoursMessage ? { outOfHoursMessage: data.outOfHoursMessage } : {}),
      },
      businessHours: {
        timezone: "America/Sao_Paulo",
        days: {
          mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday,
          ...(hasSaturday ? { sat: [data.saturdayStart, data.saturdayEnd] as [string, string] } : {}),
        },
      },
    },
  };
}

/** Form values for an existing client, so the edit form starts filled in. */
export function operationFormValues(
  operation: typeof operations.$inferSelect,
  team: (typeof people.$inferSelect)[],
): FormValues {
  const local = (phone: string) => {
    const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    return m ? `${m[1]} ${m[2]}-${m[3]}` : phone;
  };
  const days = operation.businessHours?.days ?? {};
  const weekday = days.mon ?? ["08:00", "18:00"];
  return {
    name: operation.name,
    mode: operation.mode,
    phoneNumberId: operation.phoneNumberId ?? "",
    firstResponseMinutes: String(operation.firstResponseMinutes),
    staleDays: String(operation.staleDays),
    firstReplyMessage: operation.cadence.firstReplyMessage ?? "",
    followUps: operation.cadence.followUps.map((f) => `${f.afterMinutes} ${f.template}`).join("\n"),
    reengagementTemplate: operation.cadence.reengagementTemplate ?? "",
    outOfHoursMessage: operation.cadence.outOfHoursMessage ?? "",
    weekdayStart: weekday[0],
    weekdayEnd: weekday[1],
    saturdayStart: days.sat?.[0] ?? "",
    saturdayEnd: days.sat?.[1] ?? "",
    people: team
      .filter((p) => p.active)
      .map((p) => `${p.name}; ${local(p.whatsappNumber)}; ${p.role === "manager" ? "gestor" : "vendedor"}`)
      .join("\n"),
  };
}

export const formValuesOf = (formData: FormData): FormValues =>
  Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));

export function isUniqueViolation(error: unknown) {
  const message = String((error as Error)?.message ?? "");
  return message.includes("phone_number_id") || message.includes("unique");
}
