"use client";

import { useActionState } from "react";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return <p className="notice">Enviamos um link de acesso para o seu e-mail. Abra-o neste navegador.</p>;
  }

  return (
    <form action={action} className="stack">
      <input type="hidden" name="next" value={next} />
      <label className="field">
        <span>E-mail</span>
        <input name="email" type="email" required placeholder="voce@agencia.com.br" autoComplete="email" />
      </label>
      {state.status === "error" && <p className="error">{state.message}</p>}
      <button type="submit" className="button" disabled={pending}>
        {pending ? "Enviando…" : "Enviar link de acesso"}
      </button>
    </form>
  );
}
