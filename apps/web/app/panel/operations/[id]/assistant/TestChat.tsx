"use client";

import type { AssistantState, ConversationTurn } from "@post-lead/core";
import { useState, useTransition } from "react";
import { testTurn } from "./actions";

/** Talk to the saved assistant as if you were a lead. Nothing is sent on WhatsApp. */
export function TestChat({ operationId }: { operationId: string }) {
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [state, setState] = useState<AssistantState | null>(null);
  const [handoff, setHandoff] = useState<{ reason: string; summary: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();

  const send = () => {
    const message = text.trim();
    if (!message || pending || handoff) return;
    const next = [...conversation, { from: "lead" as const, text: message }];
    setConversation(next);
    setText("");
    setError(null);
    startTransition(async () => {
      const result = await testTurn(operationId, { conversation: next, state });
      if (!result.ok) return setError(result.message);
      setConversation([...next, { from: "assistant", text: result.reply }]);
      setState(result.state);
      if (result.handoff) setHandoff({ reason: result.handoff, summary: result.summary });
    });
  };

  const restart = () => {
    setConversation([]);
    setState(null);
    setHandoff(null);
    setError(null);
  };

  return (
    <div className="stack">
      <div className="chat">
        {conversation.length === 0 && <p className="small">Escreva como se fosse um lead. Usa a versão salva e as mesmas regras do WhatsApp.</p>}
        {conversation.map((t, i) => (
          <p key={i} className={t.from === "lead" ? "bubble lead" : "bubble ai"}>{t.text}</p>
        ))}
        {pending && <p className="small">A IA está escrevendo…</p>}
      </div>
      {handoff && (
        <p className="notice">
          Passou para o vendedor: {handoff.reason}.{handoff.summary && <><br />Resumo: {handoff.summary}</>}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, minWidth: 0 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={handoff ? "Conversa encerrada" : "Mensagem do lead"}
          disabled={Boolean(handoff)}
        />
        <button type="button" className="button" onClick={send} disabled={pending || Boolean(handoff)}>Enviar</button>
      </div>
      <div>
        <button type="button" className="button secondary small-button" onClick={restart}>Recomeçar conversa</button>
      </div>
    </div>
  );
}
