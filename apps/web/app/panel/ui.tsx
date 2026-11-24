import type { Temperature } from "@post-lead/core";

export const TEMPERATURE_LABEL: Record<Temperature, string> = {
  late: "Atrasado",
  waiting: "Aguardando resposta",
  ok: "Em dia",
  closed: "Encerrado",
};

export const STAGE_LABEL: Record<string, string> = {
  new: "Novo",
  in_progress: "Em atendimento",
  won: "Ganho",
  lost: "Perdido",
  no_reply: "Sem retorno",
};

export const SOURCE_LABEL: Record<string, string> = {
  whatsapp_ad: "Anúncio",
  whatsapp: "Origem não identificada",
  form: "Formulário",
  meta_lead_ads: "Lead Ads",
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export function formatMoney(cents: number) {
  return money.format(cents / 100);
}

export function TemperatureBadge({ value }: { value: Temperature }) {
  return <span className={`badge t-${value}`}>{TEMPERATURE_LABEL[value]}</span>;
}

const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

export function formatDateTime(date: Date) {
  return dateTime.format(date);
}

export function formatPhone(phone: string) {
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}
