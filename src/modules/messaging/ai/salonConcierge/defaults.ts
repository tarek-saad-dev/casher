/** Default premium-receptionist voice. Style only — never business truth. */

import type { BrandVoiceProfile, ConciergeSnapshot } from './types';

export const DEFAULT_BANNED_ADDRESS = [
  'يا باشا',
  'يا معلم',
  'يا كبير',
  'يا نجم',
  'يا ريس',
  'يا حاج',
];

export const DEFAULT_BRAND_VOICE: BrandVoiceProfile = {
  dialect: 'egyptian_arabic',
  formality: 'polite_relaxed',
  warmth: 'high',
  humor: 'light_contextual',
  emojiUsage: 'low',
  messageLength: 'short',
  salesIntensity: 'help_first',
  greetingStyle: 'light',
  closingStyle: 'optional',
  preferredAddressTerms: ['يا فندم', 'حضرتك'],
  bannedAddressTerms: [...DEFAULT_BANNED_ADDRESS],
  preferredPhrases: ['تمام', 'حاضر'],
  bannedPhrases: ['يا باشا', 'يا معلم', 'يا كبير', 'يا نجم', 'يا ريس', 'الكتالوج', 'السيستم مش لاقي', 'ثواني هراجع'],
  behaviorRules: [
    'answer_current_first',
    'help_before_sell',
    'never_invent_salon_facts',
    'max_one_proactive_offer',
    'no_booking_nag',
    'honorific_situational',
  ],
};

export function emptyConciergeSnapshot(voice: BrandVoiceProfile = DEFAULT_BRAND_VOICE): ConciergeSnapshot {
  return {
    knowledge: [],
    capabilities: [],
    links: [],
    offers: [],
    brandVoice: { ...voice, bannedAddressTerms: [...voice.bannedAddressTerms], bannedPhrases: [...voice.bannedPhrases] },
    examples: [],
    sources: [],
    gaps: [],
  };
}

/** Production path must never use fixture data. */
export function isConciergeTestHub(): boolean {
  return process.env.VITEST === 'true' || process.env.CONCIERGE_TEST_HUB === '1';
}
