"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createOperation, type NewOperationState } from "./actions";

export function NewOperationForm({ agencies }: { agencies: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<NewOperationState, FormData>(createOperation, { status: "idle" });

  const v = state.status === "error" ? state.values : {};
  const val = (name: string, fallback = "") => v[name] ?? fallback;

  if (state.status === "created") {
    return (
      <div className="card stack">
        <p className="notice">Cliente cadastrado.</p>
        <div className="field">
          <span>Chave de captura de leads</span>
          <p className="secret">{state.intakeKey}</p>
          <small>Ela aparece só agora. Guarde-a para configurar formulários e landing pages (cabeçalho x-intake-key).</small>
        </div>
        <div className="field">
          <span>Endereço de captura</span>
          <p className="code">POST /api/intake/{state.operationId}</p>
        </div>
        <div><Link href={`/panel/operations/${state.operationId}`} className="button">Abrir o cliente</Link></div>
      </div>
    );
  }

  return (
    <form action={action} className="stack">
      {agencies.length > 1 ? (
        <label className="field">
          <span>Agência</span>
          <select name="agencyId">{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
      ) : (
        <input type="hidden" name="agencyId" value={agencies[0]?.id ?? ""} />
      )}

      <fieldset>
        <legend>Cliente</legend>
        <div className="row">
          <label className="field">
            <span>Nome</span>
            <input name="name" required placeholder="Clínica Sorriso" defaultValue={val("name")} />
          </label>
          <label className="field">
            <span>Quem atende</span>
            <select name="mode" defaultValue={val("mode", "team")}>
              <option value="team">Equipe de vendedores</option>
              <option value="solo">O próprio dono</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Pessoas que recebem avisos</span>
          <textarea name="people" required placeholder={"Bia; 77 99999-0001; vendedor\nCarlos; 77 99999-0002; gestor"} defaultValue={val("people")} />
          <small>Uma por linha: nome; WhatsApp; vendedor ou gestor.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>Conexões</legend>
        <div className="row">
          <label className="field">
            <span>ID do número do WhatsApp</span>
            <input name="phoneNumberId" placeholder="Pode ficar vazio por enquanto" defaultValue={val("phoneNumberId")} />
          </label>
          <label className="field">
            <span>ID da página do Facebook (Lead Ads)</span>
            <input name="metaPageId" placeholder="Opcional" defaultValue={val("metaPageId")} />
          </label>
        </div>
        <label className="field" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="leadAdsDisclaimerConsent" style={{ width: "auto" }} defaultChecked={v.leadAdsDisclaimerConsent === "on"} />
          <span style={{ fontWeight: 400 }}>O formulário de anúncio avisa que o contato será pelo WhatsApp</span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Atendimento automático</legend>
        <div className="row">
          <label className="field">
            <span>Modelo do primeiro contato</span>
            <input name="firstContactTemplate" defaultValue={val("firstContactTemplate", "first_contact")} required />
          </label>
          <label className="field">
            <span>Prazo para responder (X, minutos)</span>
            <input name="firstResponseMinutes" type="number" min={1} defaultValue={val("firstResponseMinutes", "5")} required />
          </label>
          <label className="field">
            <span>Conversa parada (Y, dias)</span>
            <input name="staleDays" type="number" min={1} defaultValue={val("staleDays", "3")} required />
          </label>
        </div>
        <label className="field">
          <span>Retornos para quem não respondeu</span>
          <textarea name="followUps" defaultValue={val("followUps", "60 follow_up_1\n1440 follow_up_2")} />
          <small>Uma por linha: minutos depois do primeiro contato e o nome do modelo aprovado.</small>
        </label>
        <label className="field">
          <span>Mensagem fora do horário</span>
          <textarea
            name="outOfHoursMessage"
            defaultValue={val(
              "outOfHoursMessage",
              "Recebemos sua mensagem! Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Assim que abrirmos, alguém continua com você por aqui.",
            )}
          />
        </label>
        <div className="row">
          <label className="field"><span>Seg a sex, abre</span><input name="weekdayStart" type="time" defaultValue={val("weekdayStart", "08:00")} /></label>
          <label className="field"><span>Seg a sex, fecha</span><input name="weekdayEnd" type="time" defaultValue={val("weekdayEnd", "18:00")} /></label>
          <label className="field"><span>Sábado, abre</span><input name="saturdayStart" type="time" defaultValue={val("saturdayStart")} /></label>
          <label className="field"><span>Sábado, fecha</span><input name="saturdayEnd" type="time" defaultValue={val("saturdayEnd")} /></label>
        </div>
      </fieldset>

      {state.status === "error" && <p className="error">{state.message}</p>}
      <div><button type="submit" className="button" disabled={pending}>{pending ? "Salvando…" : "Cadastrar cliente"}</button></div>
    </form>
  );
}
