# Message templates (drafts)

Messages sent more than 24 hours after the lead's last message must be approved
templates. The first reply to a new lead is not one of them: the lead wrote
first, so it is free text set per operation. Submit these in WhatsApp Manager
once the business is verified. Names must match the code.
Meta decides the final category; marketing costs about ten times more than
utility in Brazil, so keep lead messages informational where possible.

Language: `pt_BR`. Variables are `{{1}}`, `{{2}}`, …

## To leads (client's number)

Names are configurable per operation (`operations.cadence`). Texts depend on
the client's segment; these are generic starting points.

### First reply (free text, not a template)

Set per operation in `operations.cadence.firstReplyMessage`. Keep it neutral:
a number that is not a lead may receive it before the seller taps "Não é lead".

> Oi! Recebemos sua mensagem, já já alguém te responde por aqui.

### `follow_up_1` (about 1 hour later)

> {{1}}, ainda posso te ajudar? É só responder esta mensagem que um atendente continua com você.

### `follow_up_2` (about 1 day later)

> Oi, {{1}}! Passando para saber se ainda tem interesse. Se preferir não receber mais mensagens, responda SAIR.

The last follow-up offers a way out; it protects the client's number quality.

### `reengage_1` (conversation stalled for Y days)

Name set per operation (`operations.cadence.reengagementTemplate`). Meta will
likely classify it as marketing. Sent at most twice per lead, only if the
seller did not tap "Cancelar".

> Oi, {{1}}! Passando para retomar nossa conversa. Ainda posso te ajudar? Se preferir não receber mais mensagens, responda SAIR.

### Out-of-hours message (free text, not a template)

Set per operation in `operations.cadence.outOfHoursMessage`. It is a reply to
the lead's own message, so it needs no approval:

> Recebemos sua mensagem! Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Assim que abrirmos, alguém continua com você por aqui.

## To sellers and managers (tool's number)

Fixed names, defined in `packages/services/src/notifications.ts`.

### `notify_new_lead`

> Novo lead: {{1}} ({{2}}), {{3}}. A primeira resposta já foi enviada. Abra o WhatsApp Business para continuar.

Quick-reply button: **Não é lead** (stops everything and ignores the number for good).

### `notify_lead_replied`

> {{1}} respondeu. Abra o WhatsApp Business para continuar o atendimento.

### `notify_owner_reminder`

> {{1}} está esperando resposta há {{2}} minutos.

### `notify_manager_alert`

> Atenção: {{1}} está sem resposta. Responsável: {{2}}. Tempo de espera: {{3}} minutos.

### `notify_reengagement`

> A conversa com {{1}} está parada há {{2}} dias. Vou retomar o contato {{3}}. Se você combinou algo com o cliente, toque em Cancelar.

Quick-reply buttons, in this order: **Cancelar**, **Ganhou**, **Perdeu**.

### Sale value question (free text, not a template)

Sent from the tool's number right after the seller taps **Ganhou**, inside the
window that tap opened:

> Boa! Qual foi o valor da venda para {{lead}}? Responda só com o número, por exemplo 1500. Se preferir não informar, pode ignorar.

### `ask_lead_outcome`

> Como ficou o atendimento de {{1}}?

Quick-reply buttons, in this order: **Ganhou**, **Perdeu**, **Segue negociando**.

### `weekly_report`

> Resumo da semana — {{1}}
> Leads recebidos: {{2}}
> Contatados em até 1 minuto: {{3}}
> Escreveram: {{4}}
> Tempo para a equipe responder (mediana): {{5}}
> Responderam e ficaram sem resposta da equipe: {{6}}
> Vendas fechadas: {{7}}
