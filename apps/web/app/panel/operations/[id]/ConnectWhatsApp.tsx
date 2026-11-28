"use client";

import type { ConnectResult } from "@post-lead/services";
import { useEffect, useRef, useState } from "react";
import { connectWhatsAppAction } from "./connectActions";

type FacebookSdk = {
  init(options: Record<string, unknown>): void;
  login(callback: (response: { authResponse?: { code?: string } | null }) => void, options: Record<string, unknown>): void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

type SessionInfo = { waba_id?: string; phone_number_id?: string; current_step?: string; error_message?: string };

const STEP_LABEL: Record<string, string> = {
  token: "Autorização da Meta",
  webhooks: "Mensagens chegando no Post Lead",
  number: "Número",
  register: "Registro do número na API",
  saved: "Conexão salva",
  smb_app_state_sync: "Contatos do WhatsApp Business",
  history: "Histórico de 180 dias",
  templates: "Modelos de mensagem na conta do cliente",
};

/** Loads Meta's JS SDK once. */
function loadSdk(appId: string, version: string) {
  if (document.getElementById("facebook-jssdk")) return;
  window.fbAsyncInit = () => window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version });
  const script = document.createElement("script");
  script.id = "facebook-jssdk";
  script.src = "https://connect.facebook.net/pt_BR/sdk.js";
  script.async = true;
  script.defer = true;
  script.crossOrigin = "anonymous";
  document.body.appendChild(script);
}

export function ConnectWhatsApp(props: { operationId: string; appId: string; configId: string; apiVersion: string; connected: boolean }) {
  const session = useRef<SessionInfo | null>(null);
  const [state, setState] = useState<
    { status: "idle" } | { status: "working" } | { status: "cancelled"; detail?: string } | { status: "done"; result: ConnectResult }
  >({ status: "idle" });

  useEffect(() => {
    loadSdk(props.appId, props.apiVersion);
    // Embedded Signup reports the chosen account through postMessage.
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(data.event).startsWith("FINISH")) session.current = data.data ?? {};
        else if (data.event === "CANCEL") setState({ status: "cancelled", detail: data.data?.current_step });
        else if (data.event === "ERROR") setState({ status: "cancelled", detail: data.data?.error_message });
      } catch {
        // Other messages from facebook.com are not JSON; ignore them.
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.appId, props.apiVersion]);

  async function finish(code: string) {
    // The session event can arrive just after the login callback.
    for (let i = 0; i < 20 && !session.current?.waba_id; i++) await new Promise((r) => setTimeout(r, 250));
    const info = session.current ?? {};
    const result = await connectWhatsAppAction(props.operationId, {
      code,
      wabaId: info.waba_id ?? "",
      ...(info.phone_number_id ? { phoneNumberId: info.phone_number_id } : {}),
    });
    setState({ status: "done", result });
  }

  function launch() {
    if (!window.FB) {
      setState({ status: "cancelled", detail: "O SDK da Meta ainda não carregou. Tente de novo em alguns segundos." });
      return;
    }
    session.current = null;
    setState({ status: "working" });
    // The SDK refuses async callbacks, so the work happens in finish().
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (code) void finish(code);
        else setState((s) => (s.status === "cancelled" ? s : { status: "cancelled" }));
      },
      {
        config_id: props.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3" },
      },
    );
  }

  return (
    <div className="stack">
      <div>
        <button className="button" onClick={launch} disabled={state.status === "working"}>
          {state.status === "working" ? "Conectando…" : props.connected ? "Reconectar WhatsApp" : "Conectar WhatsApp"}
        </button>
      </div>
      <p className="small">
        Abre o cadastro da Meta. Se o número já usa o WhatsApp Business no celular, ele continua funcionando no app: o
        cliente confirma no próprio app, escaneando um QR code. Contatos e histórico só podem ser importados nas primeiras 24
        horas.
      </p>
      {state.status === "cancelled" && (
        <p className="error">Conexão não concluída{state.detail ? `: ${state.detail}` : "."}</p>
      )}
      {state.status === "done" && (
        <div className="stack">
          {state.result.ok ? (
            <p className="notice">
              Conectado: {state.result.displayPhone ?? state.result.phoneNumberId}
              {state.result.coexistence ? " (continua no app WhatsApp Business)" : ""}.
            </p>
          ) : (
            <p className="error">{state.result.message}</p>
          )}
          <ul className="list small">
            {state.result.steps.map((s) => (
              <li key={s.step}>
                {s.ok ? "✓" : "✗"} {STEP_LABEL[s.step] ?? s.step}
                {s.detail ? ` — ${s.detail}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
