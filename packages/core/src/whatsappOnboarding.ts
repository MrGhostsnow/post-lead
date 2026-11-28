/**
 * Graph API calls that connect a client's number after Embedded Signup.
 * See docs/whatsapp-onboarding.md for the whole flow.
 */

export type GraphOptions = { apiVersion: string; fetchImpl?: typeof fetch };

export class GraphApiError extends Error {
  constructor(message: string, readonly status: number, readonly details: unknown) {
    super(message);
    this.name = "GraphApiError";
  }
}

async function graph<T>(options: GraphOptions, path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const doFetch = options.fetchImpl ?? fetch;
  const response = await doFetch(`https://graph.facebook.com/${options.apiVersion}/${path}`, {
    method: init.method ?? "GET",
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const json = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; error_user_title?: string; error_user_msg?: string } })
    | null;
  if (!response.ok || !json) {
    const e = json?.error;
    const detail = [e?.message, e?.error_user_title, e?.error_user_msg].filter(Boolean).join(" — ");
    throw new GraphApiError(detail || `Graph API error ${response.status}`, response.status, json);
  }
  return json;
}

/** Exchanges the code from FB.login for the client's business token. */
export async function exchangeSignupCode(
  options: GraphOptions & { appId: string; appSecret: string; code: string },
): Promise<string> {
  const query = new URLSearchParams({ client_id: options.appId, client_secret: options.appSecret, code: options.code });
  const json = await graph<{ access_token?: string }>(options, `oauth/access_token?${query}`);
  if (!json.access_token) throw new GraphApiError("No access token in the code exchange", 200, json);
  return json.access_token;
}

/** Makes Meta send this account's webhooks to our app. */
export function subscribeAppToWaba(options: GraphOptions, token: string, wabaId: string) {
  return graph<{ success?: boolean }>(options, `${wabaId}/subscribed_apps`, { method: "POST", token });
}

export type WabaPhoneNumber = {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  is_on_biz_app?: boolean;
  platform_type?: string;
};

export async function listWabaPhoneNumbers(options: GraphOptions, token: string, wabaId: string): Promise<WabaPhoneNumber[]> {
  const json = await graph<{ data?: WabaPhoneNumber[] }>(
    options,
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,is_on_biz_app,platform_type`,
    { token },
  );
  return json.data ?? [];
}

/**
 * Coexistence only: asks Meta to send the contacts (smb_app_state_sync) or the
 * last 180 days of messages (history). Once each, within 24 hours of onboarding.
 */
export function requestSmbAppSync(options: GraphOptions, token: string, phoneNumberId: string, syncType: "smb_app_state_sync" | "history") {
  return graph<{ request_id?: string }>(options, `${phoneNumberId}/smb_app_data`, {
    method: "POST",
    token,
    body: { messaging_product: "whatsapp", sync_type: syncType },
  });
}

/** A number not shared with the app must be registered on Cloud API with a 6-digit PIN. */
export function registerPhoneNumber(options: GraphOptions, token: string, phoneNumberId: string, pin: string) {
  return graph<{ success?: boolean }>(options, `${phoneNumberId}/register`, {
    method: "POST",
    token,
    body: { messaging_product: "whatsapp", pin },
  });
}
