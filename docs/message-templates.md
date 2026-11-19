# Message templates (drafts)

Every message the tool starts must be an approved template. Submit these in
WhatsApp Manager once the business is verified. Names must match the code.
Meta decides the final category; marketing costs about ten times more than
utility in Brazil, so keep lead messages informational where possible.

Language: `pt_BR`. Variables are `{{1}}`, `{{2}}`, …

## To leads (client's number)

Names are configurable per operation (`operations.cadence`). Texts depend on
the client's segment; these are generic starting points.

### `first_contact`

> Olá, {{1}}! Recebemos seu contato agora há pouco. Para te atender melhor, me conta: o que você procura?

### `follow_up_1` (about 1 hour later)

> {{1}}, ainda posso te ajudar? É só responder esta mensagem que um atendente continua com você.

### `follow_up_2` (about 1 day later)

> Oi, {{1}}! Passando para saber se ainda tem interesse. Se preferir não receber mais mensagens, responda SAIR.

The last follow-up offers a way out; it protects the client's number quality.

### Out-of-hours message (free text, not a template)

Set per operation in `operations.cadence.outOfHoursMessage`. It is a reply to
the lead's own message, so it needs no approval:

> Recebemos sua mensagem! Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Assim que abrirmos, alguém continua com você por aqui.

## To sellers and managers (tool's number)

Fixed names, defined in `packages/services/src/notifications.ts`.

### `notify_new_lead`

> Novo lead: {{1}} ({{2}}), vindo de {{3}}. A primeira mensagem já foi enviada. Quando ele responder, eu te aviso.

### `notify_lead_replied`

> {{1}} respondeu. Abra o WhatsApp Business para continuar o atendimento.

### `notify_owner_reminder`

> {{1}} está esperando resposta há {{2}} minutos.

### `notify_manager_alert`

> Atenção: {{1}} está sem resposta. Responsável: {{2}}. Tempo de espera: {{3}} minutos.

### `ask_lead_outcome`

> Como ficou o atendimento de {{1}}?

Quick-reply buttons, in this order: **Ganhou**, **Perdeu**, **Segue negociando**.

### `weekly_report`

> Resumo da semana — {{1}}
> Leads recebidos: {{2}}
> Contatados em até 1 minuto: {{3}}
> Responderam: {{4}}
> Tempo para a equipe responder (mediana): {{5}}
> Responderam e ficaram sem resposta da equipe: {{6}}
> Vendas fechadas: {{7}}
