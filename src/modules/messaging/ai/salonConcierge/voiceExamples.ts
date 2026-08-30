/** Retrieve 1–3 owner voice examples for STYLE only — never as business facts. */
import { normalizeConciergeText } from './matching';
import type { ConciergeIntent, VoiceExample } from './types';

const INTENT_CATEGORY: Partial<Record<ConciergeIntent, string[]>> = {
  OPEN_NOW: ['AVAILABILITY', 'GREETING', 'CLOSED_BRANCH'],
  DIRECTIONS_MAPS: ['DIRECTIONS'],
  EXTERNAL_LINK: ['DIRECTIONS'],
  FAQ_KNOWLEDGE: ['PRICE', 'UNKNOWN_INFORMATION', 'CLARIFICATION'],
  CAPABILITY_QUERY: ['SERVICE_ADVICE', 'RECOMMENDATION'],
  CONSULTATIVE: ['SERVICE_ADVICE', 'RECOMMENDATION', 'CLARIFICATION'],
  OFFER_QUERY: ['OFFER'],
  UNKNOWN_KNOWLEDGE: ['UNKNOWN_INFORMATION', 'HUMAN_HANDOFF'],
  SERVICE_PRICE_LIVE: ['PRICE'],
  AVAILABILITY_LIVE: ['AVAILABILITY'],
  HOURS_LIVE: ['AVAILABILITY'],
};

function overlapScore(customerText: string, example: VoiceExample): number {
  const t = normalizeConciergeText(customerText);
  const e = normalizeConciergeText(example.customerMessage);
  if (!t || !e) return 0;
  if (t === e) return 100;
  if (t.includes(e) || e.includes(t)) return 80;
  const tw = new Set(t.split(' ').filter((w) => w.length >= 3));
  const ew = e.split(' ').filter((w) => w.length >= 3);
  let hits = 0;
  for (const w of ew) if (tw.has(w)) hits += 1;
  return hits === 0 ? 0 : Math.min(70, 20 + hits * 15);
}

export function pickVoiceExamples(args: {
  text: string;
  intent: ConciergeIntent;
  examples: VoiceExample[];
  limit?: number;
}): VoiceExample[] {
  const active = args.examples.filter((e) => e.isActive);
  if (!active.length) return [];
  const cats = new Set(INTENT_CATEGORY[args.intent] ?? []);
  const scored = active
    .map((ex) => {
      const catBonus = cats.has(ex.category) ? 25 : 0;
      const score = overlapScore(args.text, ex) + catBonus + Math.max(0, 20 - ex.priority);
      return { ex, score };
    })
    .filter((x) => x.score >= 25)
    .sort((a, b) => b.score - a.score || a.ex.priority - b.ex.priority);
  return scored.slice(0, args.limit ?? 3).map((x) => x.ex);
}

/**
 * Style hint only. Never replace grounded facts with a stored reply.
 */
export function ownerStyleHint(examples: VoiceExample[]): {
  preferShort: boolean;
  honorificInExamples: boolean;
  sampleLengths: number[];
} {
  const sampleLengths = examples.map((e) => e.preferredResponse.trim().length);
  const honorificInExamples = examples.some((e) =>
    /يا فندم|حضرتك/.test(e.preferredResponse),
  );
  const preferShort =
    sampleLengths.length === 0 || sampleLengths.every((n) => n <= 140);
  return { preferShort, honorificInExamples, sampleLengths };
}
