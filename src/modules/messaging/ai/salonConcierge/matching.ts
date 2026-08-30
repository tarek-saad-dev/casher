/** Egyptian-aware alias matching for knowledge / capabilities / links. */
import type { MatchResolution } from './types';

export function normalizeConciergeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[؟?!.،,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchAgainstAliases(
  text: string,
  aliases: string[],
): { resolution: MatchResolution; score: number } {
  const t = normalizeConciergeText(text);
  if (!t || !aliases.length) return { resolution: 'unknown', score: 0 };

  let best = 0;
  let hits = 0;
  for (const raw of aliases) {
    const a = normalizeConciergeText(raw);
    if (!a) continue;
    if (t === a || t.includes(a) || a.includes(t)) {
      hits += 1;
      best = Math.max(best, a.length >= 3 ? 90 : 70);
    } else if (a.length >= 4 && t.includes(a.slice(0, Math.min(4, a.length)))) {
      hits += 1;
      best = Math.max(best, 55);
    }
  }

  if (best >= 70) return { resolution: 'resolved', score: best };
  if (hits > 1 && best >= 55) return { resolution: 'ambiguous', score: best };
  if (best >= 55) return { resolution: 'ambiguous', score: best };
  return { resolution: 'unknown', score: 0 };
}
