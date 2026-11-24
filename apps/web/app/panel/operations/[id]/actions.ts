"use server";

import { eq, operations, sql } from "@post-lead/db";
import { revalidatePath } from "next/cache";
import { requireOperation, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";

/** Invalidates every client link sent so far and issues a new one. */
export async function revokeClientLinks(operationId: string) {
  const user = await requireUser();
  if (!(await requireOperation(user.id, operationId))) return;

  await getDb()
    .update(operations)
    .set({ clientLinkVersion: sql`${operations.clientLinkVersion} + 1`, updatedAt: new Date() })
    .where(eq(operations.id, operationId));
  revalidatePath(`/panel/operations/${operationId}`);
}
