import "server-only";
import { agencyMembers, and, eq, operations } from "@post-lead/db";
import { redirect } from "next/navigation";
import { getDb } from "./server";
import { createSupabaseServerClient } from "./supabase/server";

export type CurrentUser = { id: string; email: string | null };

/**
 * Local development only: DEV_AUTH_USER_ID skips Supabase so the panel can be
 * used against a local database. Ignored in production builds.
 */
function devUser(): CurrentUser | null {
  const id = process.env.DEV_AUTH_USER_ID;
  if (id && process.env.NODE_ENV !== "production") return { id, email: "dev@local" };
  return null;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const dev = devUser();
  if (dev) return dev;

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user ? { id: data.user.id, email: data.user.email ?? null } : null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Agencies the user belongs to. Empty when an admin has not added them yet. */
export async function agencyIdsFor(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ agencyId: agencyMembers.agencyId })
    .from(agencyMembers)
    .where(eq(agencyMembers.userId, userId));
  return rows.map((r) => r.agencyId);
}

/**
 * Loads an operation only if the user belongs to its agency. Server code uses
 * the service connection (no RLS), so every page must go through this check.
 */
export async function requireOperation(userId: string, operationId: string) {
  const agencies = await agencyIdsFor(userId);
  if (agencies.length === 0) return null;

  const [operation] = await getDb().select().from(operations).where(eq(operations.id, operationId));
  if (!operation || !agencies.includes(operation.agencyId)) return null;
  return operation;
}

export async function isMemberOf(userId: string, agencyId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ agencyId: agencyMembers.agencyId })
    .from(agencyMembers)
    .where(and(eq(agencyMembers.userId, userId), eq(agencyMembers.agencyId, agencyId)));
  return rows.length > 0;
}
