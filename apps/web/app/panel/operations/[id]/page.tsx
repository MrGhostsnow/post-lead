import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireOperation, requireUser } from "@/lib/auth";
import { clientLinkToken } from "@/lib/clientLink";
import { activationSummary, lastSevenDays, operationLeads, operationPeople, weeklyReports } from "@/lib/panelData";
import { formatDateTime, formatMoney, formatPhone, SOURCE_LABEL, STAGE_LABEL, TemperatureBadge } from "../../ui";
import { ClientLinkControl } from "./Controls";

export const dynamic = "force-dynamic";

const pct = (n: number | null) => (n === null ? "–" : `${n}%`);

export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const operation = await requireOperation(user.id, id);
  if (!operation) notFound();

  const [leads, team, week, reports, activation] = await Promise.all([
    operationLeads(operation),
    operationPeople(operation.id),
    lastSevenDays(operation.id),
    weeklyReports(operation.id),
    activationSummary(operation.id),
  ]);

  const origin = (await headers()).get("origin") ?? process.env.APP_URL ?? "";
  const clientUrl = `${origin}/c/${clientLinkToken(operation.id, operation.clientLinkVersion)}`;
  const late = leads.filter((l) => l.temperature === "late").length;

  return (
    <main className="page">
      <Link href="/panel" className="crumb">← Clientes</Link>
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>{operation.name}</h1>
          <p className="muted">
            {operation.mode === "team" ? "Equipe de vendedores" : "Atendido pelo dono"} · prazo de resposta {operation.firstResponseMinutes} min ·{" "}
            {operation.phoneNumberId ? "WhatsApp conectado" : "WhatsApp não conectado"}
          </p>
        </div>
        <Link href={`/panel/operations/${operation.id}/edit`} className="button secondary">Editar cliente</Link>
      </div>

      <div className="stats">
        <div className="stat"><b>{week.leadsReceived}</b><span>leads em 7 dias</span></div>
        <div className="stat"><b>{pct(week.contactedWithinMinuteRate)}</b><span>contatados em até 1 min</span></div>
        <div className="stat"><b>{week.repliedWithoutBusinessAnswer}</b><span>sem resposta da equipe</span></div>
        <div className="stat">
          <b>{week.medianBusinessResponseMinutes === null ? "–" : `${week.medianBusinessResponseMinutes} min`}</b>
          <span>para a equipe responder</span>
        </div>
        <div className="stat"><b style={{ color: late ? "var(--late)" : undefined }}>{late}</b><span>atrasados agora</span></div>
        <div className="stat">
          <b>{week.stages.won}</b>
          <span>ganhos em 7 dias{week.wonValueCents > 0 && <> · {formatMoney(week.wonValueCents)}</>}</span>
        </div>
      </div>

      <div className="grid grid-2">
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
                    <td>
                      {SOURCE_LABEL[lead.source] ?? lead.source}
                      {lead.campaign && <><br /><span className="small">{lead.campaign}</span></>}
                      {lead.knownContact && <><br /><span className="small">já era contato</span></>}
                    </td>
                    <td>
                      {STAGE_LABEL[lead.stage] ?? lead.stage}
                      {lead.saleValueCents ? <><br /><span className="small nowrap">{formatMoney(lead.saleValueCents)}</span></> : null}
                    </td>
                    <td>{lead.ownerName ?? <span className="small">–</span>}</td>
                    <td className="small nowrap">{formatDateTime(lead.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <aside className="grid" style={{ alignContent: "start" }}>
          <section className="card">
            <h2>Pessoas</h2>
            <ul className="list">
              {team.map((p) => (
                <li key={p.id}>
                  <span>{p.name}{!p.active && <span className="small"> (inativo)</span>}</span>
                  <span className="small">{p.role === "manager" ? "Gestor" : "Vendedor"} · {formatPhone(p.whatsappNumber)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Link do cliente</h2>
            <ClientLinkControl operationId={operation.id} url={clientUrl} />
          </section>

          <section className="card">
            <h2>Ativação</h2>
            <ul className="list">
              <li>
                <span>Histórico de 180 dias</span>
                <span className="small">
                  {activation.historyDeclined
                    ? "não compartilhado"
                    : activation.historyMessages
                      ? `${activation.historyMessages} mensagens${activation.historySince ? ` desde ${formatDateTime(activation.historySince).slice(0, 5)}` : ""}`
                      : "ainda não recebido"}
                </span>
              </li>
              <li><span>Contatos que não viram lead</span><span className="small">{activation.knownContacts}</span></li>
              <li><span>Marcados como “Não é lead”</span><span className="small">{activation.ignored}</span></li>
            </ul>
          </section>

          <section className="card">
            <h2>Relatórios semanais</h2>
            {reports.length === 0 ? (
              <p className="small">O primeiro sai na próxima segunda às 8h.</p>
            ) : (
              <ul className="list">
                {reports.map((r) => (
                  <li key={r.createdAt.toISOString()}>
                    <span>{formatDateTime(r.createdAt)}</span>
                    <span className="small">
                      {r.report ? `${r.report.leadsReceived} leads · ${r.report.stages.won} ganhos` : "–"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
