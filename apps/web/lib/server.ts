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

import { createClaudeAssistant, type AssistantModel } from "@post-lead/core";

let assistantModel: AssistantModel | null | undefined;

/** Same model as the worker, for "Testar conversa". Null when no key is configured. */
export function getAssistantModel(): AssistantModel | null {
  if (assistantModel === undefined) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    assistantModel = apiKey ? createClaudeAssistant({ apiKey, model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" }) : null;
  }
  return assistantModel;
}
