"use client";

import { useState } from "react";
import { revokeClientLinks } from "./actions";

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
