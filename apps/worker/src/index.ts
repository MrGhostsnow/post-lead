/**
 * Long-running process: applies stored webhooks and runs scheduled actions
 * (first contact, follow-ups, reminders, alerts). Run exactly one instance in
 * the MVP; claiming uses SKIP LOCKED, but there is no lease for crashed jobs
 * other than recoverStuckActions at startup.
 */
import { createWhatsAppClient } from "@post-lead/core";
import { createDb } from "@post-lead/db";
import { processPendingWebhooks, recoverStuckActions, runDueActions } from "@post-lead/services";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const db = createDb();
const whatsapp = createWhatsAppClient({
  accessToken: required("META_ACCESS_TOKEN"),
  apiVersion: required("GRAPH_API_VERSION"),
});
const toolPhoneNumberId = required("TOOL_PHONE_NUMBER_ID");
const pollIntervalMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);

let running = true;
const stop = () => {
  running = false;
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function tick() {
  const webhooks = await processPendingWebhooks(db, { toolPhoneNumberId });
  const actions = await runDueActions({ db, whatsapp, toolPhoneNumberId });
  if (webhooks || actions) {
    console.log(`[worker] webhooks=${webhooks} actions=${actions}`);
  }
}

async function main() {
  await recoverStuckActions(db);
  console.log("[worker] started");

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
