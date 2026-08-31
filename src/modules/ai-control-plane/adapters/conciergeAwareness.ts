import { DEFAULT_BRAND_VOICE } from '@/modules/messaging/ai/salonConcierge/defaults';

export function getConciergeAwarenessHints(): {
  existingBannedPhrases: string[];
} {
  return {
    existingBannedPhrases: [
      ...DEFAULT_BRAND_VOICE.bannedAddressTerms,
      ...DEFAULT_BRAND_VOICE.bannedPhrases,
    ],
  };
}
