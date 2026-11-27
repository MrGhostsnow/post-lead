/** Runs on every deploy before the worker starts. Uses the direct (non-pooled) connection. */
import { runMigrations } from "@post-lead/db/migrate";

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL_DIRECT (or DATABASE_URL) is not set");
  process.exit(1);
}
await runMigrations(url);
console.log("[migrate] database is up to date");
process.exit(0);
