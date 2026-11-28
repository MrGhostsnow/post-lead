"use server";

import { normalizeBrazilPhone } from "@post-lead/core";
import { inArray, operations } from "@post-lead/db";
import { simulateInbound } from "@post-lead/services";
import { revalidatePath } from "next/cache";
import { agencyIdsFor, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";

export type SimulateState = { status: "idle" } | { status: "error"; message: string } | { status: "sent" };

/** Numbers the user may write to: their clients' numbers and the tool's number. */
async function allowedNumbers(userId: string) {
  const agencies = await agencyIdsFor(userId);
  if (agencies.length === 0) return new Set<string>();
  const rows = await getDb()
    .select({ phoneNumberId: operations.phoneNumberId })
    .from(operations)
    .where(inArray(operations.agencyId, agencies));
  const ids = new Set(rows.map((r) => r.phoneNumberId).filter((id): id is string => Boolean(id)));
  const tool = process.env.TOOL_PHONE_NUMBER_ID;
  if (tool) ids.add(tool);
  return ids;
}

/** "Someone writes to this number": a lead to a client's number, or a seller to the tool's number. */
export async function simulateMessage(_prev: SimulateState, formData: FormData): Promise<SimulateState> {
  const user = await requireUser();
  const phoneNumberId = String(formData.get("phoneNumberId") ?? "");
  const from = normalizeBrazilPhone(String(formData.get("from") ?? ""));
  const text = String(formData.get("text") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!(await allowedNumbers(user.id)).has(phoneNumberId)) return { status: "error", message: "Escolha um número da lista." };
  if (!from) return { status: "error", message: "Telefone inválido. Use DDD + número, por exemplo 77 99999-0000." };
  if (!text) return { status: "error", message: "Escreva a mensagem." };

  await simulateInbound(getDb(), { phoneNumberId, from, name, text });
  revalidatePath("/panel/sandbox");
  return { status: "sent" };
}

/** "The person tapped this button" on a message the tool sent them. */
export async function tapButton(formData: FormData) {
  const user = await requireUser();
  const phoneNumberId = String(formData.get("phoneNumberId") ?? "");
  const from = String(formData.get("to") ?? "");
  const buttonId = String(formData.get("buttonId") ?? "");
  const buttonTitle = String(formData.get("buttonTitle") ?? "");
  if (!(await allowedNumbers(user.id)).has(phoneNumberId) || !from || !buttonId) return;

  await simulateInbound(getDb(), { phoneNumberId, from, buttonId, buttonTitle });
  revalidatePath("/panel/sandbox");
}
