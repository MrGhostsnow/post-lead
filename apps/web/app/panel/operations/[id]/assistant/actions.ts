"use server";

import { randomUUID } from "node:crypto";
import {
  applyModelTurn,
  buildSystemPrompt,
  handoffSummary,
  HANDOFF_LABEL,
  isWithinBusinessHours,
  newAssistantState,
  readAssistantSettings,
  type AssistantState,
  type ConversationTurn,
} from "@post-lead/core";
import { and, assistantVersions, eq, operations } from "@post-lead/db";
import { revalidatePath } from "next/cache";
import { requireOperation, requireUser } from "@/lib/auth";
import { parseAssistantForm } from "@/lib/assistantForm";
import { formValuesOf, type FormValues } from "@/lib/operationForm";
import { getAssistantModel, getDb } from "@/lib/server";

export type SaveState = { status: "idle" } | { status: "error"; message: string; values: FormValues } | { status: "saved" };

/** Saves the settings and keeps the previous ones as a version. */
export async function saveAssistant(operationId: string, _prev: SaveState, formData: FormData): Promise<SaveState> {
  const user = await requireUser();
  const values = formValuesOf(formData);
  if (!(await requireOperation(user.id, operationId))) return { status: "error", message: "Você não tem acesso a esse cliente.", values };

  const form = parseAssistantForm(formData);
  if (!form.ok) return { status: "error", message: form.message, values };

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(operations).set({ assistant: form.settings, updatedAt: new Date() }).where(eq(operations.id, operationId));
    await tx.insert(assistantVersions).values({ operationId, settings: form.settings, savedBy: user.id });
  });
  revalidatePath(`/panel/operations/${operationId}/assistant`);
  return { status: "saved" };
}

/** Puts an earlier version back, as a new version, so the history stays linear. */
export async function restoreVersion(operationId: string, versionId: string) {
  const user = await requireUser();
  if (!(await requireOperation(user.id, operationId))) return;
  const db = getDb();
  const [version] = await db
    .select()
    .from(assistantVersions)
    .where(and(eq(assistantVersions.id, versionId), eq(assistantVersions.operationId, operationId)));
  if (!version) return;
  await db.transaction(async (tx) => {
    await tx.update(operations).set({ assistant: version.settings, updatedAt: new Date() }).where(eq(operations.id, operationId));
    await tx.insert(assistantVersions).values({ operationId, settings: version.settings, savedBy: user.id });
  });
  revalidatePath(`/panel/operations/${operationId}/assistant`);
}

export type TestTurnResult =
  | { ok: true; reply: string; state: AssistantState; handoff: string | null; summary: string | null }
  | { ok: false; message: string };

/** One turn of "Testar conversa", with the saved settings and the same rules as production. */
export async function testTurn(
  operationId: string,
  input: { conversation: ConversationTurn[]; state: AssistantState | null },
): Promise<TestTurnResult> {
  const user = await requireUser();
  const operation = await requireOperation(user.id, operationId);
  if (!operation) return { ok: false, message: "Você não tem acesso a esse cliente." };
  const settings = readAssistantSettings(operation.assistant);
  if (!settings) return { ok: false, message: "Salve as configurações antes de testar." };
  const model = getAssistantModel();
  if (!model) return { ok: false, message: "A chave da IA (ANTHROPIC_API_KEY) não está configurada." };

  const state = input.state ?? newAssistantState(randomUUID());
  if (state.status !== "active") return { ok: false, message: "A IA já passou esta conversa. Comece outra." };
  const conversation = input.conversation.slice(-40).map((t) => ({ from: t.from, text: String(t.text).slice(0, 2000) }));

  try {
    const closedNow = Boolean(operation.businessHours && !isWithinBusinessHours(new Date(), operation.businessHours));
    const turn = await model.respond({
      system: buildSystemPrompt(settings, { closedNow }),
      conversation,
      fieldKeys: settings.fields.map((f) => f.key),
    });
    const decision = applyModelTurn(state, turn, settings, { isFirstReply: !conversation.some((t) => t.from === "assistant") });
    return {
      ok: true,
      reply: decision.reply,
      state: decision.state,
      handoff: decision.handoff ? HANDOFF_LABEL[decision.handoff] : null,
      summary: decision.handoff ? handoffSummary(decision.state, settings) : null,
    };
  } catch (error) {
    return { ok: false, message: `A IA falhou: ${error instanceof Error ? error.message : String(error)}. Em produção, o lead receberia a resposta fixa.` };
  }
}
