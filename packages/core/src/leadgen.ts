/**
 * Meta Lead Ads: the "leadgen" webhook only carries ids; the lead's answers
 * must be fetched from the Graph API with a token that has leads_retrieval
 * on the page (an agency system user that manages the client's page works).
 */

export type LeadgenEvent = {
  leadgenId: string;
  pageId: string;
  formId: string | null;
  adId: string | null;
  createdAt: Date;
};

type RawLeadgenPayload = {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        leadgen_id?: string;
        page_id?: string;
        form_id?: string;
        ad_id?: string;
        created_time?: number;
      };
    }[];
  }[];
};

export function parseLeadgenWebhook(payload: unknown): LeadgenEvent[] {
  const body = payload as RawLeadgenPayload;
  if (body?.object !== "page") return [];

  const events: LeadgenEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (change.field !== "leadgen" || !value?.leadgen_id) continue;
      const pageId = value.page_id ?? entry.id;
      if (!pageId) continue;
      events.push({
        leadgenId: value.leadgen_id,
        pageId,
        formId: value.form_id ?? null,
        adId: value.ad_id ?? null,
        createdAt: new Date((value.created_time ?? 0) * 1000),
      });
    }
  }
  return events;
}

export type LeadFieldData = { name: string; values: string[] }[];

export type FetchedLead = {
  id: string;
  fieldData: LeadFieldData;
  campaignName: string | null;
  adName: string | null;
  formId: string | null;
};

/** Custom question that, when present on the form, holds the WhatsApp opt-in. */
export const WHATSAPP_CONSENT_FIELD = "whatsapp_consent";

const YES = new Set(["sim", "yes", "true", "1", "s", "aceito", "concordo"]);

export type ParsedLeadFields = {
  name: string | null;
  phone: string | null;
  email: string | null;
  /** null when the form has no consent question. */
  whatsappConsent: boolean | null;
};

export function parseLeadFields(fields: LeadFieldData): ParsedLeadFields {
  const get = (...names: string[]) => {
    for (const name of names) {
      const value = fields.find((f) => f.name.toLowerCase() === name)?.values[0]?.trim();
      if (value) return value;
    }
    return null;
  };

  const fullName =
    get("full_name", "nome_completo", "nome") ??
    ([get("first_name"), get("last_name")].filter(Boolean).join(" ") || null);

  const consentAnswer = get(WHATSAPP_CONSENT_FIELD);

  return {
    name: fullName,
    phone: get("phone_number", "phone", "telefone", "whatsapp"),
    email: get("email"),
    whatsappConsent: consentAnswer === null ? null : YES.has(consentAnswer.toLowerCase()),
  };
}

export type MetaLeadsClient = {
  fetchLead(leadgenId: string): Promise<FetchedLead>;
};

export function createMetaLeadsClient(options: {
  accessToken: string;
  apiVersion: string;
  fetchImpl?: typeof fetch;
}): MetaLeadsClient {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    async fetchLead(leadgenId) {
      const url = new URL(`https://graph.facebook.com/${options.apiVersion}/${leadgenId}`);
      url.searchParams.set("fields", "field_data,campaign_name,ad_name,form_id");
      const response = await doFetch(url, {
        headers: { Authorization: `Bearer ${options.accessToken}` },
      });
      const json = (await response.json().catch(() => null)) as {
        id?: string;
        field_data?: LeadFieldData;
        campaign_name?: string;
        ad_name?: string;
        form_id?: string;
        error?: { message?: string };
      } | null;

      if (!response.ok || !json) {
        throw new Error(json?.error?.message ?? `Graph API error ${response.status} fetching lead ${leadgenId}`);
      }
      return {
        id: json.id ?? leadgenId,
        fieldData: json.field_data ?? [],
        campaignName: json.campaign_name ?? null,
        adName: json.ad_name ?? null,
        formId: json.form_id ?? null,
      };
    },
  };
}
