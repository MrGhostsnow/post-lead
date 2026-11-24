"use client";

import Link from "next/link";
import { useActionState } from "react";
import { OperationFields } from "../../OperationFields";
import { updateOperation, type EditOperationState } from "./actions";

function teamSummary(t: { added: number; updated: number; deactivated: number; reassigned: number }) {
  const parts = [
    t.added && `${t.added} pessoa(s) adicionada(s)`,
    t.updated && `${t.updated} atualizada(s)`,
    t.deactivated && `${t.deactivated} removida(s) dos avisos`,
    t.reassigned && `${t.reassigned} lead(s) aberto(s) passado(s) para outra pessoa`,
  ].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : "";
}

export function EditOperationForm({ operationId, initial }: { operationId: string; initial: Record<string, string> }) {
  const [state, action, pending] = useActionState<EditOperationState, FormData>(updateOperation.bind(null, operationId), {
    status: "idle",
  });

  const typed = state.status === "error" ? state.values : {};
  const val = (name: string) => typed[name] ?? initial[name] ?? "";

  return (
    <form action={action} className="stack">
      <OperationFields val={val} editing />

      {state.status === "error" && <p className="error">{state.message}</p>}
      {state.status === "saved" && <p className="notice">Alterações salvas. {teamSummary(state.team)}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" className="button" disabled={pending}>{pending ? "Salvando…" : "Salvar alterações"}</button>
        <Link href={`/panel/operations/${operationId}`} className="button secondary">Voltar ao cliente</Link>
      </div>
    </form>
  );
}
