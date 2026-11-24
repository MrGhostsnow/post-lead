"use server";

import { createHash, randomBytes } from "node:crypto";
import { eq, operations, sql } from "@post-lead/db";
import { revalidatePath } from "next/cache";
import { requireOperation, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";

export type KeyState = { status: "idle" } | { status: "done"; key: string } | { status: "error" };

/** Issues a new intake key. The old one stops working immediately. */
export async function rotateIntakeKey(operationId: string, _prev: KeyState): Promise<KeyState> {
  const user = await requireUser();
  if (!(await requireOperation(user.id, operationId))) return { status: "error" };

  const key = randomBytes(24).toString("base64url");
  await getDb()
    .update(operations)
    .set({ intakeKeyHash: createHash("sha256").update(key).digest("hex"), updatedAt: new Date() })
    .where(eq(operations.id, operationId));
  return { status: "done", key };
}

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
