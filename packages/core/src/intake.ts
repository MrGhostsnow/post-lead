/**
 * Who becomes a lead when a number writes to the client's WhatsApp for the
 * first time. Pure, so the rule is tested apart from the database.
 *
 * - Ignored ("Não é lead" was tapped once): never a lead, never answered.
 * - Came from a click-to-WhatsApp ad: a lead with the campaign, even if the
 *   client already knew the number (someone who taps an ad is buying).
 * - Already in the 180-day history, the app's address book, or a chat the
 *   client started: not a new lead.
 * - Anyone else: a lead of unknown origin.
 */

export type KnownContact = {
  inAddressBook: boolean;
  lastMessageAt: Date | null;
  ignoredAt: Date | null;
};

export type IntakeDecision =
  | { kind: "ignore"; reason: "ignored" | "known_contact" }
  | { kind: "lead"; source: "whatsapp_ad" | "whatsapp"; knownContact: boolean };

export function classifyNewNumber(input: { fromAd: boolean; contact: KnownContact | null }): IntakeDecision {
  const { contact, fromAd } = input;
  if (contact?.ignoredAt) return { kind: "ignore", reason: "ignored" };

  const known = Boolean(contact && (contact.inAddressBook || contact.lastMessageAt));
  if (fromAd) return { kind: "lead", source: "whatsapp_ad", knownContact: known };
  if (known) return { kind: "ignore", reason: "known_contact" };
  return { kind: "lead", source: "whatsapp", knownContact: false };
}

/**
 * Reads the sale value a seller types after "Ganhou": "1500", "1.500,00",
 * "R$ 1.500", "1500.50", "1,5 mil" is not supported. Returns cents or null.
 */
export function parseSaleValue(text: string): number | null {
  let s = text.replace(/r\$|\s/gi, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  const decimalSep = lastComma > lastDot ? "," : ".";
  const decimalPart = s.slice(s.lastIndexOf(decimalSep) + 1);
  const hasDecimals = s.includes(decimalSep) && decimalPart.length > 0 && decimalPart.length <= 2;

  if (hasDecimals) {
    const intPart = s.slice(0, s.lastIndexOf(decimalSep)).replace(/[.,]/g, "");
    s = `${intPart}.${decimalPart}`;
  } else {
    s = s.replace(/[.,]/g, "");
  }

  const value = Number(s);
  if (!Number.isFinite(value) || value <= 0 || value > 100_000_000) return null;
  return Math.round(value * 100);
}
