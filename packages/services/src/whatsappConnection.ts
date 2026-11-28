import { randomInt } from "node:crypto";
import {
  createTemplateManager,
  decryptSecret,
  encryptSecret,
  exchangeSignupCode,
  listWabaPhoneNumbers,
  registerPhoneNumber,
  requestSmbAppSync,
  subscribeAppToWaba,
  syncTemplates,
  type GraphOptions,
  type TemplateSyncResult,
} from "@post-lead/core";
import { and, eq, isNotNull, ne, operations, type Database } from "@post-lead/db";

export type ConnectionConfig = GraphOptions & {
  appId: string;
  appSecret: string;
  /** TOKEN_ENCRYPTION_KEY: 32 bytes, base64. */
  encryptionKey: string;
};

export type ConnectInput = {
  operationId: string;
  /** From FB.login, exchanged once for the client's business token. */
  code: string;
  /** From the Embedded Signup session event. */
  wabaId: string;
  /** Missing when the client onboarded their WhatsApp Business app number. */
  phoneNumberId?: string;
};

export type ConnectStep = { step: string; ok: boolean; detail?: string };

export type ConnectResult =
  | { ok: true; phoneNumberId: string; displayPhone: string | null; coexistence: boolean; steps: ConnectStep[]; templates: TemplateSyncResult[] }
  | { ok: false; message: string; steps: ConnectStep[] };

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Finishes Embedded Signup for one client: business token, app subscription,
 * number (registered, or shared with the app), history and contacts within the
 * 24-hour window, and the lead templates on the client's account. Every step
 * is reported; only the ones the connection cannot work without stop it.
 */
export async function connectWhatsApp(db: Database, config: ConnectionConfig, input: ConnectInput): Promise<ConnectResult> {
  const steps: ConnectStep[] = [];
  const fail = (step: string, error: unknown): ConnectResult => {
    steps.push({ step, ok: false, detail: message(error) });
    return { ok: false, message: `${step}: ${message(error)}`, steps };
  };

  let token: string;
  try {
    token = await exchangeSignupCode({ ...config, code: input.code });
    steps.push({ step: "token", ok: true });
  } catch (error) {
    return fail("token", error);
  }

  try {
    await subscribeAppToWaba(config, token, input.wabaId);
    steps.push({ step: "webhooks", ok: true });
  } catch (error) {
    return fail("webhooks", error);
  }

  let numbers;
  try {
    numbers = await listWabaPhoneNumbers(config, token, input.wabaId);
  } catch (error) {
    return fail("number", error);
  }
  const number = numbers.find((n) => n.id === input.phoneNumberId) ?? numbers.find((n) => n.is_on_biz_app) ?? numbers[0];
  if (!number) return fail("number", "the account has no phone number");
  const coexistence = number.is_on_biz_app === true;
  steps.push({ step: "number", ok: true, detail: `${number.display_phone_number ?? number.id}${coexistence ? " (coexistência)" : ""}` });

  const [taken] = await db
    .select({ id: operations.id, name: operations.name })
    .from(operations)
    .where(and(eq(operations.phoneNumberId, number.id), ne(operations.id, input.operationId)));
  if (taken) return fail("number", `this number is already connected to the client "${taken.name}"`);

  if (!coexistence) {
    // Cloud API only: register with a two-step PIN. The PIN is not needed again
    // unless the number is re-registered, and then it can be reset in WhatsApp Manager.
    try {
      await registerPhoneNumber(config, token, number.id, String(randomInt(0, 1_000_000)).padStart(6, "0"));
      steps.push({ step: "register", ok: true });
    } catch (error) {
      return fail("register", error);
    }
  }

  const now = new Date();
  await db
    .update(operations)
    .set({
      wabaId: input.wabaId,
      phoneNumberId: number.id,
      displayPhone: number.display_phone_number ?? null,
      accessTokenEncrypted: encryptSecret(token, config.encryptionKey),
      coexistence,
      whatsappConnectedAt: now,
      updatedAt: now,
    })
    .where(eq(operations.id, input.operationId));
  steps.push({ step: "saved", ok: true });

  if (coexistence) {
    // Contacts first: the history step needs the address book to skip known people.
    for (const syncType of ["smb_app_state_sync", "history"] as const) {
      try {
        await requestSmbAppSync(config, token, number.id, syncType);
        steps.push({ step: syncType, ok: true });
      } catch (error) {
        steps.push({ step: syncType, ok: false, detail: message(error) });
      }
    }
    await db.update(operations).set({ historySyncRequestedAt: new Date() }).where(eq(operations.id, input.operationId));
  }

  let templates: TemplateSyncResult[] = [];
  try {
    templates = await syncTemplates(createTemplateManager({ ...config, accessToken: token }), input.wabaId, ["lead"]);
    const failed = templates.filter((t) => t.result === "failed");
    steps.push({ step: "templates", ok: failed.length === 0, detail: failed.map((t) => `${t.name}: ${t.error}`).join("; ") || undefined });
  } catch (error) {
    steps.push({ step: "templates", ok: false, detail: message(error) });
  }

  return { ok: true, phoneNumberId: number.id, displayPhone: number.display_phone_number ?? null, coexistence, steps, templates };
}

/**
 * Token for sending from a number: the client's own when it was connected
 * through Embedded Signup, otherwise the tool's system-user token. Cached for a
 * minute so the worker does not hit the database on every message.
 */
export function createTokenResolver(db: Database, options: { fallbackToken: string; encryptionKey?: string; ttlMs?: number }) {
  const cache = new Map<string, { token: string; at: number }>();
  const ttl = options.ttlMs ?? 60_000;

  return async (phoneNumberId: string): Promise<string> => {
    const hit = cache.get(phoneNumberId);
    if (hit && Date.now() - hit.at < ttl) return hit.token;

    let token = options.fallbackToken;
    if (options.encryptionKey) {
      const [row] = await db
        .select({ sealed: operations.accessTokenEncrypted })
        .from(operations)
        .where(and(eq(operations.phoneNumberId, phoneNumberId), isNotNull(operations.accessTokenEncrypted)));
      if (row?.sealed) token = decryptSecret(row.sealed, options.encryptionKey);
    }
    cache.set(phoneNumberId, { token, at: Date.now() });
    return token;
  };
}
