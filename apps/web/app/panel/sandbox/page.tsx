import { and, desc, eq, inArray, messages, operations, people, sandboxMessages } from "@post-lead/db";
import { agencyIdsFor, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/server";
import { formatDateTime, formatPhone } from "../ui";
import { tapButton } from "./actions";
import { AutoRefresh } from "./AutoRefresh";
import { SimulateForm, type NumberOption } from "./SimulateForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sandbox · Post Lead" };

type FeedItem =
  | { kind: "out"; at: Date; id: string; from: string; to: string; body: string; template: string | null; buttons: { id: string; title: string }[] }
  | { kind: "in"; at: Date; id: string; from: string; to: string; body: string };

export default async function SandboxPage() {
  const user = await requireUser();
  const agencies = await agencyIdsFor(user.id);
  const db = getDb();

  const ops = agencies.length
    ? await db.select().from(operations).where(inArray(operations.agencyId, agencies))
    : [];
  const tool = process.env.TOOL_PHONE_NUMBER_ID ?? null;
  const clientNumbers = ops.filter((o) => o.phoneNumberId).map((o) => o.phoneNumberId!);
  const scope = [...new Set([...clientNumbers, ...(tool ? [tool] : [])])];

  // Who is who, to label the feed.
  const team = ops.length ? await db.select().from(people).where(inArray(people.operationId, ops.map((o) => o.id))) : [];
  const nameOf = (phone: string) => team.find((p) => p.whatsappNumber.slice(-8) === phone.slice(-8))?.name;
  const numberLabel = (id: string) => {
    const clients = ops.filter((o) => o.phoneNumberId === id).map((o) => o.name);
    if (id === tool) return clients.length ? `Ferramenta / ${clients.join(", ")}` : "Ferramenta (avisos à equipe)";
    return clients.join(", ") || id;
  };

  const outbox = scope.length
    ? await db.select().from(sandboxMessages).where(inArray(sandboxMessages.phoneNumberId, scope)).orderBy(desc(sandboxMessages.createdAt)).limit(60)
    : [];
  const inbound = ops.length
    ? await db
        .select({ id: messages.id, operationId: messages.operationId, body: messages.body, sentAt: messages.sentAt, leadId: messages.leadId })
        .from(messages)
        .where(and(inArray(messages.operationId, ops.map((o) => o.id)), eq(messages.direction, "inbound")))
        .orderBy(desc(messages.sentAt))
        .limit(60)
    : [];

  const feed: FeedItem[] = [
    ...outbox.map((m) => ({
      kind: "out" as const,
      at: m.createdAt,
      id: m.id,
      from: m.phoneNumberId,
      to: m.to,
      body: m.body,
      template: m.template,
      buttons: m.buttons,
    })),
    ...inbound.map((m) => ({
      kind: "in" as const,
      at: m.sentAt,
      id: m.id,
      from: "lead",
      to: ops.find((o) => o.id === m.operationId)?.phoneNumberId ?? "",
      body: m.body ?? "(sem texto)",
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 80);

  const numbers: NumberOption[] = scope.map((id) => ({ id, label: numberLabel(id) }));

  return (
    <main className="page">
      <AutoRefresh />
      <div className="page-head">
        <div>
          <h1>Sandbox</h1>
          <p className="muted">
            Com o modo sandbox ligado no worker, nada é enviado à Meta: tudo o que a ferramenta mandaria aparece aqui.
            Mensagens reais que chegam pelo WhatsApp continuam entrando.
          </p>
        </div>
      </div>

      <div className="grid">
        <section className="card stack">
          <h2>Simular mensagem recebida</h2>
          <p className="small">
            Escreva como um lead (para o número do cliente) ou como alguém da equipe (para o número da ferramenta, por
            exemplo o valor da venda depois de “Ganhou”).
          </p>
          {numbers.length ? <SimulateForm numbers={numbers} /> : <p className="empty">Cadastre um cliente com o ID do número primeiro.</p>}
        </section>

        <section className="card stack">
          <h2>Mensagens</h2>
          {feed.length === 0 ? (
            <p className="empty">Nada ainda. Simule uma mensagem ou escreva para o número de teste.</p>
          ) : (
            <ul className="list sandbox-feed">
              {feed.map((item) =>
                item.kind === "in" ? (
                  <li key={`in-${item.id}`} className="sandbox-item in">
                    <p className="small">{formatDateTime(item.at)} · lead escreveu para {numberLabel(item.to)}</p>
                    <p className="bubble lead">{item.body}</p>
                  </li>
                ) : (
                  <li key={`out-${item.id}`} className="sandbox-item out">
                    <p className="small">
                      {formatDateTime(item.at)} · {numberLabel(item.from)} → {nameOf(item.to) ? `${nameOf(item.to)} ` : ""}
                      {formatPhone(item.to)}
                      {item.template ? <> · modelo <span className="code">{item.template}</span></> : null}
                    </p>
                    <p className="bubble ai">{item.body}</p>
                    {item.buttons.length > 0 && (
                      <div className="sandbox-buttons">
                        {item.buttons.map((b) => (
                          <form key={b.id} action={tapButton}>
                            <input type="hidden" name="phoneNumberId" value={item.from} />
                            <input type="hidden" name="to" value={item.to} />
                            <input type="hidden" name="buttonId" value={b.id} />
                            <input type="hidden" name="buttonTitle" value={b.title} />
                            <button className="button secondary small-button">{b.title}</button>
                          </form>
                        ))}
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
