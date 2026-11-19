/**
 * Phone helpers for Brazilian numbers in the format WhatsApp uses: digits only,
 * country code first, no "+" (e.g. "5577999998888").
 */

const BRAZIL_COUNTRY_CODE = "55";

/**
 * Normalizes user input ("(77) 99999-8888", "+55 77 99999 8888", "77999998888")
 * to WhatsApp digits. Returns null when the input cannot be a Brazilian phone.
 */
export function normalizeBrazilPhone(input: string): string | null {
  const digits = input.replace(/\D/g, "").replace(/^0+/, "");

  // Area code (2) + subscriber (8 or 9).
  if (digits.length === 10 || digits.length === 11) {
    return BRAZIL_COUNTRY_CODE + digits;
  }
  if (digits.startsWith(BRAZIL_COUNTRY_CODE) && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  return null;
}

/**
 * WhatsApp may report a Brazilian mobile number with or without the ninth digit
 * (e.g. "5577999998888" in a form, "557799998888" as the wa_id). Lookups must
 * try both forms, or the same person becomes two leads.
 */
export function brazilPhoneVariants(phone: string): string[] {
  if (!phone.startsWith(BRAZIL_COUNTRY_CODE)) return [phone];
  const area = phone.slice(2, 4);
  const subscriber = phone.slice(4);

  if (subscriber.length === 9 && subscriber.startsWith("9")) {
    return [phone, BRAZIL_COUNTRY_CODE + area + subscriber.slice(1)];
  }
  if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
    return [phone, BRAZIL_COUNTRY_CODE + area + "9" + subscriber];
  }
  return [phone];
}
