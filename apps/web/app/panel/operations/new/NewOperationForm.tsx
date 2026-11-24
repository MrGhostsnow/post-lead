"use client";

import Link from "next/link";
import { useActionState } from "react";
import { OperationFields } from "../OperationFields";
import { createOperation, type NewOperationState } from "./actions";

export function NewOperationForm({
  agencies,
  defaults,
}: {
  agencies: { id: string; name: string }[];
  defaults: Record<string, string>;
}) {
  const [state, action, pending] = useActionState<NewOperationState, FormData>(createOperation, { status: "idle" });

  const typed = state.status === "error" ? state.values : {};
  const val = (name: string) => typed[name] ?? defaults[name] ?? "";

  if (state.status === "created") {
    return (
      <div className="card stack">
        <p className="notice">Cliente cadastrado.</p>
        <p>
          Quando o número do cliente estiver conectado, cada nova conversa no WhatsApp dele vira lead e recebe a primeira
          resposta em segundos.
        </p>
        <div><Link href={`/panel/operations/${state.operationId}`} className="button">Abrir o cliente</Link></div>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      {agencies.length > 1 ? (
        <label className="field">
          <span>Agência</span>
          <select name="agencyId" defaultValue={val("agencyId")}>{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
      ) : (
        <input type="hidden" name="agencyId" value={agencies[0]?.id ?? ""} />
      )}

      <OperationFields val={val} />

      {state.status === "error" && <p className="error">{state.message}</p>}
      <div><button type="submit" className="button" disabled={pending}>{pending ? "Salvando…" : "Cadastrar cliente"}</button></div>
    </form>
  );
}
