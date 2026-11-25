/**
 * Long-running process: applies stored webhooks and runs scheduled actions
 * (first reply, follow-ups, reminders, alerts, resumptions, weekly reports). Run exactly
 * one instance in the MVP; claiming uses SKIP LOCKED, but there is no lease
 * for crashed jobs other than recoverStuckActions at startup.
 */
import { createClaudeAssistant, createWhatsAppClient } from "@post-lead/core";
import { createDb } from "@post-lead/db";
import {
  ensureWeeklyReportsScheduled,
  processPendingWebhooks,
  recoverStuckActions,
  runDueActions,
} from "@post-lead/services";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const apiVersion = required("GRAPH_API_VERSION");
const db = createDb();
const whatsapp = createWhatsAppClient({ accessToken: required("META_ACCESS_TOKEN"), apiVersion });
const toolPhoneNumberId = required("TOOL_PHONE_NUMBER_ID");
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);

// Optional: without a key, clients with the assistant on get the fixed reply and go straight to a person.
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const assistant = anthropicKey
  ? createClaudeAssistant({ apiKey: anthropicKey, model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5" })
  : undefined;

const HOUR_MS = 60 * 60 * 1000;
let lastReportCheck = 0;

let running = true;
const stop = () => {
  running = false;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function tick() {
  if (Date.now() - lastReportCheck > HOUR_MS) {
    await ensureWeeklyReportsScheduled(db);
    lastReportCheck = Date.now();
  }

  const webhooks = await processPendingWebhooks(db, { toolPhoneNumberId });
  const actions = await runDueActions({ db, whatsapp, toolPhoneNumberId, assistant });
  if (webhooks || actions) {
    console.log(`[worker] webhooks=${webhooks} actions=${actions}`);
  }
}

async function main() {
  await recoverStuckActions(db);
  console.log(`[worker] started${assistant ? "" : " (assistant off: ANTHROPIC_API_KEY not set)"}`);

  while (running) {
    try {
      await tick();
    } catch (error) {
      console.error("[worker] tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log("[worker] stopped");
  process.exit(0);
}

void main();
