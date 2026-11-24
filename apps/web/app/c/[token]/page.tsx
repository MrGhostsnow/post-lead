import { eq, operations } from "@post-lead/db";
import { notFound } from "next/navigation";
import { isValidClientLink, parseClientLinkToken } from "@/lib/clientLink";
import { lastSevenDays, operationLeads, stageCounts } from "@/lib/panelData";
import { getDb } from "@/lib/server";
import { formatDateTime, formatPhone, SOURCE_LABEL, STAGE_LABEL, TemperatureBadge } from "../../panel/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seus leads", robots: { index: false, follow: false } };

const pct = (n: number | null) => (n === null ? "–" : `${n}%`);

/** Read-only view for the client. No login: the signed link is the credential. */
export default async function ClientView({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const parsed = parseClientLinkToken(token);
  if (!parsed) notFound();

  const [operation] = await getDb()
    .select()
    .from(operations)
    .where(eq(operations.id, parsed.operationId))
    .catch(() => []);
  if (!operation || !isValidClientLink(operation.id, operation.clientLinkVersion, parsed.signature)) notFound();

  const [leads, week, stages] = await Promise.all([
    operationLeads(operation, 200),
    lastSevenDays(operation.id),
    stageCounts(operation.id),
  ]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{operation.name}</h1>
          <p className="muted">Acompanhamento dos seus leads. Atualizado a cada visita.</p>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><b>{week.leadsReceived}</b><span>leads nos últimos 7 dias</span></div>
        <div className="stat"><b>{pct(week.contactedWithinMinuteRate)}</b><span>receberam contato em até 1 min</span></div>
        <div className="stat">
          <b>{week.medianBusinessResponseMinutes === null ? "–" : `${week.medianBusinessResponseMinutes} min`}</b>
          <span>tempo da sua equipe para responder</span>
        </div>
        <div className="stat"><b>{week.repliedWithoutBusinessAnswer}</b><span>responderam e ficaram sem retorno</span></div>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>Funil</h2>
        <div className="stats" style={{ margin: 0 }}>
          {(["new", "in_progress", "won", "lost", "no_reply"] as const).map((stage) => (
            <div key={stage} className="stat"><b>{stages[stage]}</b><span>{STAGE_LABEL[stage]}</span></div>
          ))}
        </div>
      </section>

      <section className="card table-wrap">
        <h2>Leads</h2>
        {leads.length === 0 ? (
          <p className="empty">Nenhum lead ainda.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Situação</th><th>Lead</th><th>Origem</th><th>Etapa</th><th>Responsável</th><th>Chegou</th></tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td><TemperatureBadge value={lead.temperature} /></td>
                  <td className="nowrap"><b>{lead.contactName ?? "Sem nome"}</b><br /><span className="small nowrap">{formatPhone(lead.contactPhone)}</span></td>
                  <td>{SOURCE_LABEL[lead.source] ?? lead.source}{lead.campaign && <><br /><span className="small">{lead.campaign}</span></>}</td>
                  <td>{STAGE_LABEL[lead.stage] ?? lead.stage}</td>
                  <td>{lead.ownerName ?? "–"}</td>
                  <td className="small nowrap">{formatDateTime(lead.receivedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
