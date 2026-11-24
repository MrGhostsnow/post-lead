/** Fields shared by the new-client and edit-client forms. */
export function OperationFields({ val, editing = false }: { val: (name: string) => string; editing?: boolean }) {
  return (
    <>
      <fieldset>
        <legend>Cliente</legend>
        <div className="row">
          <label className="field">
            <span>Nome</span>
            <input name="name" required placeholder="Clínica Sorriso" defaultValue={val("name")} />
          </label>
          <label className="field">
            <span>Quem atende</span>
            <select name="mode" defaultValue={val("mode")}>
              <option value="team">Equipe de vendedores</option>
              <option value="solo">O próprio dono</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Pessoas que recebem avisos</span>
          <textarea name="people" required placeholder={"Bia; 77 99999-0001; vendedor\nCarlos; 77 99999-0002; gestor"} defaultValue={val("people")} />
          <small>
            Uma por linha: nome; WhatsApp; vendedor ou gestor.
            {editing && " Quem sair da lista para de receber avisos, e os leads abertos dessa pessoa passam para o próximo do rodízio."}
          </small>
        </label>
      </fieldset>

      <fieldset>
        <legend>WhatsApp</legend>
        <label className="field">
          <span>ID do número do WhatsApp do cliente</span>
          <input name="phoneNumberId" placeholder="Pode ficar vazio até conectar o número" defaultValue={val("phoneNumberId")} />
        </label>
      </fieldset>

      <fieldset>
        <legend>Atendimento automático</legend>
        <label className="field">
          <span>Primeira resposta ao lead</span>
          <textarea name="firstReplyMessage" required defaultValue={val("firstReplyMessage")} />
          <small>Sai em segundos, como texto livre. Mantenha neutra: um número que não é lead pode recebê-la antes de alguém tocar em “Não é lead”.</small>
        </label>
        <div className="row">
          <label className="field">
            <span>Prazo para responder (X, minutos)</span>
            <input name="firstResponseMinutes" type="number" min={1} defaultValue={val("firstResponseMinutes")} required />
          </label>
          <label className="field">
            <span>Conversa parada (Y, dias)</span>
            <input name="staleDays" type="number" min={1} defaultValue={val("staleDays")} required />
          </label>
        </div>
        <label className="field">
          <span>Retornos para quem parou de responder</span>
          <textarea name="followUps" defaultValue={val("followUps")} />
          <small>Uma por linha: minutos depois da primeira resposta e o nome do modelo aprovado.</small>
        </label>
        <label className="field">
          <span>Modelo de retomada da conversa parada</span>
          <input name="reengagementTemplate" placeholder="Vazio: só pergunta ao vendedor se ganhou ou perdeu" defaultValue={val("reengagementTemplate")} />
          <small>Depois de Y dias parado, o vendedor é avisado com um botão Cancelar; sem cancelamento em 2 horas, este modelo é enviado. No máximo duas vezes por lead.</small>
        </label>
        <label className="field">
          <span>Mensagem fora do horário</span>
          <textarea name="outOfHoursMessage" defaultValue={val("outOfHoursMessage")} />
        </label>
        <div className="row">
          <label className="field"><span>Seg a sex, abre</span><input name="weekdayStart" type="time" defaultValue={val("weekdayStart")} /></label>
          <label className="field"><span>Seg a sex, fecha</span><input name="weekdayEnd" type="time" defaultValue={val("weekdayEnd")} /></label>
          <label className="field"><span>Sábado, abre</span><input name="saturdayStart" type="time" defaultValue={val("saturdayStart")} /></label>
          <label className="field"><span>Sábado, fecha</span><input name="saturdayEnd" type="time" defaultValue={val("saturdayEnd")} /></label>
        </div>
      </fieldset>
    </>
  );
}
