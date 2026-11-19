/**
 * Long-running process: applies stored webhooks and runs scheduled actions
 * (first contact, follow-ups, reminders, alerts, weekly reports). Run exactly
 * one instance in the MVP; claiming uses SKIP LOCKED, but there is no lease
 * for crashed jobs other than recoverStuckActions at startup.
 */
import { createMetaLeadsClient, createWhatsAppClient } from "@post-lead/core";
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

// Optional until Lead Ads is connected; without it, leadgen webhooks wait and retry.
const leadsToken = process.env.META_LEADS_ACCESS_TOKEN;
const leadsClient = leadsToken ? createMetaLeadsClient({ accessToken: leadsToken, apiVersion }) : undefined;

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

  const webhooks = await processPendingWebhooks(db, { toolPhoneNumberId, leadsClient });
  const actions = await runDueActions({ db, whatsapp, toolPhoneNumberId });
  if (webhooks || actions) {
    console.log(`[worker] webhooks=${webhooks} actions=${actions}`);
  }
}

async function main() {
  await recoverStuckActions(db);
  console.log(`[worker] started${leadsClient ? "" : " (Lead Ads disabled: META_LEADS_ACCESS_TOKEN not set)"}`);

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
