import "server-only";
import { verifyMetaSignature } from "@post-lead/core";
import { storeWebhook } from "@post-lead/services";
import { getDb, requiredEnv } from "./server";

/** Answers the one-time verification request Meta sends when the URL is saved. */
export function handleVerification(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token === requiredEnv("META_WEBHOOK_VERIFY_TOKEN") && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/**
 * Verifies the signature, stores the raw payload and answers 200 right away.
 * The worker does the processing, so a slow step never makes Meta retry.
 */
export async function handleDelivery(request: Request, provider: string): Promise<Response> {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyMetaSignature(rawBody, signature, requiredEnv("META_APP_SECRET"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    await storeWebhook(getDb(), provider, rawBody);
  } catch (error) {
    console.error(`[webhook:${provider}] failed to store`, error);
    // A non-2xx answer makes Meta deliver the payload again later.
    return new Response("Storage error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
