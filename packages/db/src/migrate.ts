import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies pending migrations from packages/db/migrations. Used on deploy, where
 * drizzle-kit (a dev dependency) is not installed. Same journal table, so it is
 * safe to mix with `npm run db:migrate` locally.
 */
export async function runMigrations(url: string) {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
  } finally {
    await client.end();
  }
}
