import { WEBHOOK_PROVIDERS } from "@post-lead/services";
import { handleDelivery, handleVerification } from "@/lib/metaWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Page webhooks, field "leadgen" (Lead Ads). Configure it in the App Dashboard
 * under Webhooks > Page, and subscribe each client page to the app.
 */
export function GET(request: Request) {
  return handleVerification(request);
}

export function POST(request: Request) {
  return handleDelivery(request, WEBHOOK_PROVIDERS.metaLeadgen);
}
