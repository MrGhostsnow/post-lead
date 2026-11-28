"use server";

import { connectWhatsApp, type ConnectResult } from "@post-lead/services";
import { revalidatePath } from "next/cache";
import { requireOperation, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";

/** Finishes Embedded Signup on the server: the code never leaves it as a token. */
export async function connectWhatsAppAction(
  operationId: string,
  input: { code: string; wabaId: string; phoneNumberId?: string },
): Promise<ConnectResult> {
  const user = await requireUser();
  if (!(await requireOperation(user.id, operationId))) return { ok: false, message: "Você não tem acesso a esse cliente.", steps: [] };

  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!appId || !appSecret || !encryptionKey) {
    return { ok: false, message: "Faltam variáveis no servidor: NEXT_PUBLIC_META_APP_ID, META_APP_SECRET e TOKEN_ENCRYPTION_KEY.", steps: [] };
  }
  if (!input.code || !input.wabaId) return { ok: false, message: "A Meta não devolveu os dados da conta. Tente de novo.", steps: [] };

  const result = await connectWhatsApp(
    getDb(),
    { appId, appSecret, encryptionKey, apiVersion: process.env.GRAPH_API_VERSION ?? "v25.0" },
    { operationId, ...input },
  );
  revalidatePath(`/panel/operations/${operationId}`);
  return result;
}
