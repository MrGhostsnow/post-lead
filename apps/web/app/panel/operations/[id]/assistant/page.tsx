import Link from "next/link";
import { notFound } from "next/navigation";
import { readAssistantSettings } from "@post-lead/core";
import { requireOperation, requireUser } from "@/lib/auth";
import { assistantFormValues } from "@/lib/assistantForm";
import { activationSummary, assistantVersionList, openingStats } from "@/lib/panelData";
import { getAssistantModel } from "@/lib/server";
import { formatDateTime } from "../../../ui";
import { restoreVersion } from "./actions";
import { AssistantForm } from "./AssistantForm";
import { TestChat } from "./TestChat";

export const dynamic = "force-dynamic";
export const metadata = { title: "IA de pré-atendimento · Post Lead" };

export default async function AssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const operation = await requireOperation(user.id, id);
  if (!operation) notFound();

  const settings = readAssistantSettings(operation.assistant);
  const [versions, openings, activation] = await Promise.all([
    assistantVersionList(operation.id),
    openingStats(operation.id),
    activationSummary(operation.id),
  ]);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

  return (
    <main className="page">
      <Link href={`/panel/operations/${operation.id}`} className="crumb">← {operation.name}</Link>
      <div className="page-head">
        <div>
          <h1>IA de pré-atendimento</h1>
          <p className="muted">
            {settings?.enabled ? "Ligada" : "Desligada"} · conversa com o lead só para coletar os dados e passa para o vendedor com um resumo
            {!getAssistantModel() && " · chave da IA não configurada: os leads recebem a resposta fixa"}
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        <section className="card">
          <AssistantForm operationId={operation.id} initial={assistantFormValues(settings, operation.name)} />
        </section>

        <aside className="grid" style={{ alignContent: "start" }}>
          <section className="card">
            <h2>Testar conversa</h2>
            <TestChat operationId={operation.id} />
          </section>

          <section className="card">
            <h2>Perguntas do histórico</h2>
            {activation.faqSuggestions.length === 0 ? (
              <p className="small">Aparecem aqui depois da ativação, lidas uma vez do histórico de 180 dias (sem os contatos da agenda).</p>
            ) : (
              <>
                <ul className="list">
                  {activation.faqSuggestions.map((q) => <li key={q}><span>{q}</span></li>)}
                </ul>
                <p className="small">Copie para “Perguntas frequentes” as que a IA pode responder, com a resposta aprovada.</p>
              </>
            )}
          </section>

          <section className="card">
            <h2>Aberturas</h2>
            <ul className="list">
              {openings.map((o) => (
                <li key={o.variant}>
                  <span>Abertura {o.variant === 0 ? "A" : "B"}</span>
                  <span className="small">{o.leads} leads · {pct(o.replied, o.leads)} responderam</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Versões</h2>
            {versions.length === 0 ? (
              <p className="small">Nenhuma versão salva ainda.</p>
            ) : (
              <ul className="list">
                {versions.map((v, i) => (
                  <li key={v.id}>
                    <span>{formatDateTime(v.createdAt)}{i === 0 && <span className="small"> (atual)</span>}</span>
                    {i > 0 && (
                      <form action={restoreVersion.bind(null, operation.id, v.id)}>
                        <button type="submit" className="button secondary small-button">Restaurar</button>
                      </form>
                    )}
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
