"use server";

import { eq, operations } from "@post-lead/db";
import { syncTeam, type TeamSyncResult } from "@post-lead/services";
import { revalidatePath } from "next/cache";
import { requireOperation, requireUser } from "@/lib/auth";
import { formValuesOf, isUniqueViolation, parseOperationForm, type FormValues } from "@/lib/operationForm";
import { getDb } from "@/lib/server";

export type EditOperationState =
  | { status: "idle" }
  | { status: "error"; message: string; values: FormValues }
  | { status: "saved"; team: TeamSyncResult };

/**
 * Saves a client's settings and team. Cadence and hours apply to what is
 * scheduled from now on; steps already queued keep their time.
 */
export async function updateOperation(operationId: string, _prev: EditOperationState, formData: FormData): Promise<EditOperationState> {
  const user = await requireUser();
  const values = formValuesOf(formData);
  const fail = (message: string): EditOperationState => ({ status: "error", message, values });

  const operation = await requireOperation(user.id, operationId);
  if (!operation) return fail("Você não tem acesso a esse cliente.");

  const form = parseOperationForm(formData, operation.cadence);
  if (!form.ok) return fail(form.message);

  const db = getDb();
  try {
    await db.update(operations).set({ ...form.settings, updatedAt: new Date() }).where(eq(operations.id, operationId));
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Esse número do WhatsApp já está ligado a outro cliente.");
    throw error;
  }
  const team = await syncTeam(db, operationId, form.team);

  revalidatePath(`/panel/operations/${operationId}`);
  return { status: "saved", team };
}
