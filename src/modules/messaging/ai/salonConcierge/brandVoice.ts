/** Brand voice policy — style only; never overrides business truth. */
import { DEFAULT_BANNED_ADDRESS, DEFAULT_BRAND_VOICE } from './defaults';
import { ownerStyleHint } from './voiceExamples';
import type { BrandVoiceProfile, ConciergeIntent, VoiceExample } from './types';

export const BANNED_SLANG_DEFAULT = DEFAULT_BANNED_ADDRESS;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsBannedSlang(
  text: string,
  voice: BrandVoiceProfile = DEFAULT_BRAND_VOICE,
): boolean {
  const banned = [...(voice.bannedAddressTerms ?? []), ...(voice.bannedPhrases ?? [])];
  const t = text;
  return banned.some((b) => b && t.includes(b));
}

export function stripBannedTerms(text: string, voice: BrandVoiceProfile): string {
  let out = text;
  const banned = [
    ...(voice.bannedAddressTerms ?? []),
    ...(voice.bannedPhrases ?? []),
  ].filter(Boolean);
  for (const term of banned) {
    out = out.replace(new RegExp(escapeRe(term), 'gi'), '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+([،,.])/g, '$1').trim();
}

export type HonorificSituation = 'open_yes' | 'clarify_branch' | 'none';

/**
 * Situational addressing. Never append يا فندم to every sentence.
 */
export function applySituationalHonorific(args: {
  answer: string;
  situation: HonorificSituation;
  voice?: BrandVoiceProfile;
}): string {
  const voice = args.voice ?? DEFAULT_BRAND_VOICE;
  let text = args.answer.trim();
  if (/يا فندم|حضرتك/.test(text)) return text;
  const preferred = voice.preferredAddressTerms ?? [];
  const fandem = preferred.find((t) => t.includes('فندم')) ?? 'يا فندم';
  const hadritak = preferred.find((t) => t.includes('حضرتك')) ?? 'حضرتك';

  if (args.situation === 'open_yes') {
    if (/^أيوه[,،]?\s*/.test(text)) {
      return text.replace(/^أيوه[,،]?\s*/, `أيوه ${fandem}، `);
    }
    return text;
  }
  if (args.situation === 'clarify_branch') {
    if (!text.includes(hadritak)) {
      return `${hadritak} ${text}`;
    }
  }
  return text;
}

export function applyBrandVoice(args: {
  answer: string;
  voice?: BrandVoiceProfile | null;
  optionalOfferLine?: string | null;
  examples?: VoiceExample[];
  intent?: ConciergeIntent;
  situation?: HonorificSituation;
}): string {
  const voice = args.voice ?? DEFAULT_BRAND_VOICE;
  let text = stripBannedTerms(args.answer.trim(), voice);

  if (args.situation && args.situation !== 'none') {
    text = applySituationalHonorific({ answer: text, situation: args.situation, voice });
    text = stripBannedTerms(text, voice);
  }

  const hint = ownerStyleHint(args.examples ?? []);
  if (hint.preferShort && text.length > 420) {
    text = text.slice(0, 420).trim();
  }

  if (
    args.optionalOfferLine &&
    voice.salesIntensity !== 'none' &&
    !/عرض|خصم/.test(text)
  ) {
    text = `${text}\n\n${args.optionalOfferLine}`;
  }

  return text.trim();
}

export function unknownFactReply(): string {
  return 'مش حابب أقول لحضرتك معلومة مش مؤكدة. لو تحب أوضحلي المطلوب أكتر وأشوف أنسب حاجة نقدر نساعدك بيها.';
}

export function politeWithoutAddress(answer: string, voice?: BrandVoiceProfile): string {
  return applyBrandVoice({ answer, voice, situation: 'none' });
}
