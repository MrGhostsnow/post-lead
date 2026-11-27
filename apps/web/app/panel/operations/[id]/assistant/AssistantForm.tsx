"use client";

import { useActionState } from "react";
import { saveAssistant, type SaveState } from "./actions";

export function AssistantForm({ operationId, initial }: { operationId: string; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveAssistant.bind(null, operationId), { status: "idle" });
  const typed = state.status === "error" ? state.values : null;
  const val = (name: string) => (typed ? (typed[name] ?? "") : (initial[name] ?? ""));

  return (
    <form action={action} className="stack">
      <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" name="enabled" style={{ width: "auto" }} defaultChecked={val("enabled") === "on"} />
        <span style={{ fontWeight: 500 }}>IA ligada para os próximos leads deste cliente</span>
      </label>

      <fieldset>
        <legend>Identidade</legend>
        <div className="row">
          <label className="field">
            <span>Nome da assistente</span>
            <input name="name" placeholder="Bia (opcional)" defaultValue={val("name")} />
          </label>
          <label className="field">
            <span>Nome da empresa na conversa</span>
            <input name="companyName" required defaultValue={val("companyName")} />
          </label>
          <label className="field">
            <span>Quem assume depois da IA</span>
            <input name="teamLabel" placeholder="vendedor, consultor, equipe" defaultValue={val("teamLabel") || "vendedor"} />
          </label>
        </div>
        <label className="field">
          <span>Abertura A</span>
          <textarea name="openingA" required defaultValue={val("openingA")} />
        </label>
        <label className="field">
          <span>Abertura B</span>
          <textarea name="openingB" defaultValue={val("openingB")} />
          <small>Cada lead recebe uma das duas, e o painel mostra quantos responderam em cada uma. Precisam dizer que é a assistente virtual.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>O que a IA coleta</legend>
        <label className="field">
          <span>Dados a coletar, na ordem</span>
          <textarea name="fields" required rows={5} defaultValue={val("fields")} placeholder={"Procura | O que você está procurando?\nMelhor horário | Qual o melhor horário pro vendedor te chamar?"} />
          <small>Um por linha: rótulo | como perguntar. O rótulo aparece no resumo que o vendedor recebe. Com todos coletados, a IA passa o lead.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>O que a IA pode dizer</legend>
        <label className="field">
          <span>Informações da empresa</span>
          <textarea name="allowedInfo" rows={3} defaultValue={val("allowedInfo")} placeholder="Endereço, horário de atendimento, formas de pagamento" />
        </label>
        <label className="field">
          <span>Perguntas frequentes</span>
          <textarea name="faq" rows={4} defaultValue={val("faq")} placeholder="Vocês têm estacionamento? | Sim, gratuito para clientes." />
          <small>Uma por linha: pergunta | resposta aprovada. Fora disso, a IA não inventa: passa para o vendedor.</small>
        </label>
        <label className="field">
          <span>Instruções extras</span>
          <textarea name="extraInstructions" rows={3} defaultValue={val("extraInstructions")} />
          <small>
            Nunca passam por cima das regras fixas: a IA não fala preço, prazo ou estoque, se apresenta como assistente virtual e passa
            para o vendedor quando pedem alguém, reclamam ou insistem no valor.
          </small>
        </label>
      </fieldset>

      {state.status === "error" && <p className="error">{state.message}</p>}
      {state.status === "saved" && <p className="notice">Salvo. Vale para os próximos leads; cada versão fica na lista ao lado.</p>}
      <div><button type="submit" className="button" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</button></div>
    </form>
  );
}
