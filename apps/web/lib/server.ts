import "server-only";
import { createDb, type Database } from "@post-lead/db";

let db: Database | undefined;

/** One connection pool per server instance. */
export function getDb(): Database {
  db ??= createDb();
  return db;
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
