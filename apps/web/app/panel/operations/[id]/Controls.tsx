"use client";

import { useActionState, useState } from "react";
import { revokeClientLinks, rotateIntakeKey, type KeyState } from "./actions";

export function IntakeKeyControl({ operationId }: { operationId: string }) {
  const [state, action, pending] = useActionState<KeyState>(rotateIntakeKey.bind(null, operationId), { status: "idle" });

  if (state.status === "done") {
    return (
      <div className="stack">
        <p className="secret">{state.key}</p>
        <p className="small">Nova chave criada. A anterior parou de funcionar. Ela aparece só agora.</p>
      </div>
    );
  }
  return (
    <form action={action}>
      <button className="button secondary" disabled={pending} type="submit">
        {pending ? "Gerando…" : "Gerar nova chave de captura"}
      </button>
      {state.status === "error" && <p className="error">Não foi possível gerar a chave.</p>}
    </form>
  );
}

export function ClientLinkControl({ operationId, url }: { operationId: string; url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="stack">
      <p className="code">{url}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="button secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          }}
        >
          {copied ? "Copiado" : "Copiar link"}
        </button>
        <form action={revokeClientLinks.bind(null, operationId)}>
          <button type="submit" className="button secondary">Revogar e gerar outro</button>
        </form>
      </div>
      <p className="small">Quem tiver o link vê os leads deste cliente, sem poder editar.</p>
    </div>
  );
}
