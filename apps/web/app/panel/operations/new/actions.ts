"use server";

import { operations, people } from "@post-lead/db";
import { z } from "zod";
import { agencyIdsFor, requireUser } from "@/lib/auth";
import { formValuesOf, isUniqueViolation, parseOperationForm, type FormValues } from "@/lib/operationForm";
import { getDb } from "@/lib/server";

export type NewOperationState =
  | { status: "idle" }
  | { status: "error"; message: string; values: FormValues }
  | { status: "created"; operationId: string };

export async function createOperation(_prev: NewOperationState, formData: FormData): Promise<NewOperationState> {
  const user = await requireUser();
  // React resets the form after an action; sending the values back keeps what was typed.
  const values = formValuesOf(formData);
  const fail = (message: string): NewOperationState => ({ status: "error", message, values });

  const agencyId = z.uuid().safeParse(String(formData.get("agencyId") ?? ""));
  if (!agencyId.success || !(await agencyIdsFor(user.id)).includes(agencyId.data)) {
    return fail("Você não tem acesso a essa agência.");
  }

  const form = parseOperationForm(formData);
  if (!form.ok) return fail(form.message);

  try {
    const operationId = await getDb().transaction(async (tx) => {
      const [operation] = await tx
        .insert(operations)
        .values({ agencyId: agencyId.data, ...form.settings })
        .returning({ id: operations.id });
      await tx.insert(people).values(form.team.map((p) => ({ ...p, operationId: operation!.id })));
      return operation!.id;
    });
    return { status: "created", operationId };
  } catch (error) {
    if (isUniqueViolation(error)) return fail("Esse número do WhatsApp já está ligado a outro cliente.");
    throw error;
  }
}
