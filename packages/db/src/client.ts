import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Server-side connection. It bypasses row-level security, so callers must
 * scope every query by operation_id.
 */
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  // prepare: false is required by Supabase's transaction pooler.
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}
