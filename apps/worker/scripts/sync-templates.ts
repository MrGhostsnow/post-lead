/**
 * Creates the missing message templates on a WhatsApp Business Account.
 *
 *   npm run sync-templates -w @post-lead/worker -- --waba <WABA_ID> [--audience team|lead|all]
 *
 * Needs META_ACCESS_TOKEN (with whatsapp_business_management on that account)
 * and GRAPH_API_VERSION. Templates that already exist are left alone.
 */
import { createTemplateManager, syncTemplates, TEMPLATE_DEFINITIONS, templateProblems, type TemplateAudience } from "@post-lead/core";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const wabaId = arg("waba");
  const audience = arg("audience") ?? "all";
  const accessToken = process.env.META_ACCESS_TOKEN;
  const apiVersion = process.env.GRAPH_API_VERSION ?? "v25.0";
  if (!wabaId || !accessToken) {
    console.error("Usage: --waba <WABA_ID> [--audience team|lead|all], with META_ACCESS_TOKEN set");
    process.exit(1);
  }

  for (const t of TEMPLATE_DEFINITIONS) {
    const problems = templateProblems(t);
    if (problems.length) throw new Error(`${t.name}: ${problems.join("; ")}`);
  }

  const audiences: TemplateAudience[] = audience === "all" ? ["team", "lead"] : [audience as TemplateAudience];
  const results = await syncTemplates(createTemplateManager({ accessToken, apiVersion }), wabaId, audiences);
  for (const r of results) console.log(`${r.name}: ${r.result}${r.status ? ` (${r.status})` : ""}${r.error ? ` — ${r.error}` : ""}`);
}

void main();
