import { WEBHOOK_PROVIDERS } from "@post-lead/services";
import { handleDelivery, handleVerification } from "@/lib/metaWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** WhatsApp Business Account webhooks: "messages" and "smb_message_echoes". */
export function GET(request: Request) {
  return handleVerification(request);
}

export function POST(request: Request) {
  return handleDelivery(request, WEBHOOK_PROVIDERS.whatsapp);
}
