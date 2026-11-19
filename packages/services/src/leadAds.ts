import { parseLeadFields, type LeadgenEvent, type MetaLeadsClient } from "@post-lead/core";
import { eq, events, operations, type Database } from "@post-lead/db";
import { createLead } from "./leads";

/**
 * Turns a Lead Ads submission into a lead. The page decides the operation;
 * consent comes from a "whatsapp_consent" question when the form has one,
 * otherwise from the operation's disclaimer setting.
 */
export async function handleLeadgen(db: Database, client: MetaLeadsClient, event: LeadgenEvent) {
  const [operation] = await db.select().from(operations).where(eq(operations.metaPageId, event.pageId));
  if (!operation) return;

  const fetched = await client.fetchLead(event.leadgenId);
  const fields = parseLeadFields(fetched.fieldData);

  if (!fields.phone) {
    await db.insert(events).values({
      operationId: operation.id,
      type: "lead_ads_missing_phone",
      payload: { leadgenId: event.leadgenId, formId: fetched.formId },
    });
    return;
  }

  const result = await createLead(db, {
    operationId: operation.id,
    contactName: fields.name,
    contactEmail: fields.email,
    phone: fields.phone,
    source: "meta_lead_ads",
    campaign: fetched.campaignName,
    ad: fetched.adName,
    utm: {
      leadgen_id: event.leadgenId,
      ...(fetched.formId ? { form_id: fetched.formId } : {}),
      ...(event.adId ? { ad_id: event.adId } : {}),
    },
    whatsappConsent: fields.whatsappConsent ?? operation.leadAdsDisclaimerConsent,
  });

  if (result.status === "invalid_phone") {
    await db.insert(events).values({
      operationId: operation.id,
      type: "lead_ads_invalid_phone",
      payload: { leadgenId: event.leadgenId, phone: fields.phone },
    });
  }
}
