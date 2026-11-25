/**
 * What the 180-day history says about a client before the tool: how fast the
 * business answered and how often it did not. Computed from time and direction
 * only, so no message text is needed.
 */

export type HistoryPoint = { contactPhone: string; direction: "inbound" | "outbound"; sentAt: Date };

export type HistoryBaseline = {
  contacts: number;
  /** Times a contact wrote and waited for the business. */
  waits: number;
  medianResponseMinutes: number | null;
  /** Share of waits the business never answered, 0 to 100. */
  unansweredRate: number | null;
};

export function historyBaseline(points: HistoryPoint[]): HistoryBaseline {
  const byContact = new Map<string, HistoryPoint[]>();
  for (const p of points) byContact.set(p.contactPhone, [...(byContact.get(p.contactPhone) ?? []), p]);

  const responses: number[] = [];
  let waits = 0;
  let unanswered = 0;
  for (const thread of byContact.values()) {
    thread.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    let waitingSince: Date | null = null;
    for (const p of thread) {
      if (p.direction === "inbound") {
        // A wait starts at the first message after the business last spoke.
        waitingSince ??= p.sentAt;
      } else if (waitingSince) {
        waits += 1;
        responses.push((p.sentAt.getTime() - waitingSince.getTime()) / 60_000);
        waitingSince = null;
      }
    }
    if (waitingSince) {
      waits += 1;
      unanswered += 1;
    }
  }

  const sorted = responses.sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length ? (sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2) : null;
  return {
    contacts: byContact.size,
    waits,
    medianResponseMinutes: median === null ? null : Math.round(median),
    unansweredRate: waits ? Math.round((unanswered / waits) * 100) : null,
  };
}

type RawHistoryPayload = {
  entry?: { changes?: { field?: string; value?: { history?: { threads?: { id?: string; messages?: { from?: string; text?: { body?: string } }[] }[] }[] } }[] }[];
};

/**
 * Lead-side texts from raw history webhooks, for building the FAQ list once.
 * Skips the given phones (the address book) and keeps it short: what each
 * contact wrote first and anything that looks like a question.
 */
export function historyLeadTexts(payloads: unknown[], skipPhones: Set<string>, limit = 300): string[] {
  const texts: string[] = [];
  for (const payload of payloads) {
    for (const entry of (payload as RawHistoryPayload)?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "history") continue;
        for (const chunk of change.value?.history ?? []) {
          for (const thread of chunk.threads ?? []) {
            if (!thread.id || skipPhones.has(thread.id)) continue;
            const fromLead = (thread.messages ?? []).filter((m) => m.from === thread.id && m.text?.body?.trim());
            fromLead.forEach((m, i) => {
              const body = m.text!.body!.trim();
              if (i === 0 || body.includes("?")) texts.push(body.slice(0, 300));
            });
          }
        }
      }
    }
  }
  return texts.slice(0, limit);
}
