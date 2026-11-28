"use client";

import { useActionState } from "react";
import { simulateMessage, type SimulateState } from "./actions";

export type NumberOption = { id: string; label: string };

export function SimulateForm({ numbers }: { numbers: NumberOption[] }) {
  const [state, action, pending] = useActionState<SimulateState, FormData>(simulateMessage, { status: "idle" });

  return (
    <form action={action} className="stack">
      <div className="row">
        <label className="field">
          <span>Para qual número</span>
          <select name="phoneNumberId" required defaultValue={numbers[0]?.id}>
            {numbers.map((n) => (
              <option key={n.id} value={n.id}>{n.label}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>De (WhatsApp de quem escreve)</span>
          <input name="from" placeholder="77 99999-0000" required />
        </label>
        <label className="field">
          <span>Nome no WhatsApp</span>
          <input name="name" placeholder="Ana Souza" />
        </label>
      </div>
      <label className="field">
        <span>Mensagem</span>
        <textarea name="text" rows={2} placeholder="Oi, quero saber o preço" required />
      </label>
      <div>
        <button className="button" disabled={pending}>{pending ? "Enviando…" : "Simular mensagem recebida"}</button>
      </div>
      {state.status === "error" && <p className="error">{state.message}</p>}
      {state.status === "sent" && <p className="small">Recebida. O worker processa em poucos segundos e a resposta aparece abaixo.</p>}
    </form>
  );
}
