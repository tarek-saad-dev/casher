/**
 * Salon Concierge Brain — domain types.
 * LIVE ERP > curated knowledge > imported > model (never invent salon facts).
 */

export const KNOWLEDGE_CATEGORIES = [
  'BRANCH_INFO',
  'DIRECTIONS',
  'CONTACT',
  'OPENING_POLICY',
  'SERVICE_INFO',
  'SERVICE_EXPLANATION',
  'CAPABILITY',
  'EMPLOYEE_EXPERTISE',
  'POLICY',
  'PAYMENT',
  'BOOKING_HELP',
  'FAQ',
  'OFFER',
  'PROMOTION',
  'WEBSITE',
  'SOCIAL_LINK',
  'GOOGLE_MAPS',
  'PRODUCT',
  'GENERAL_BRAND_INFO',
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export type KnowledgeSource = 'curated' | 'imported' | 'erp_mirror' | 'live_tool';

export type KnowledgeItem = {
  id: number;
  key: string;
  category: KnowledgeCategory | string;
  branchId: number | null;
  branchCode: string | null;
  employeeId: number | null;
  language: string;
  title: string;
  subject: string | null;
  answerText: string;
  aliases: string[];
  tags: string[];
  source: KnowledgeSource;
  status: 'active' | 'draft' | 'inactive';
  priority: number;
  validFrom: string | null;
  validTo: string | null;
  updatedAt?: string | null;
};

export type CapabilityItem = {
  id: number;
  key: string;
  displayNameAr: string;
  aliases: string[];
  descriptionAr: string | null;
  serviceIds: number[];
  employeeIds: number[];
  employeeNames: string[];
  branchCodes: string[];
  status: 'active' | 'draft' | 'inactive';
};

export type ExternalLinkItem = {
  id: number;
  key: string;
  linkType:
    | 'WEBSITE'
    | 'BOOKING'
    | 'GOOGLE_MAPS'
    | 'INSTAGRAM'
    | 'FACEBOOK'
    | 'TIKTOK'
    | 'WHATSAPP'
    | 'BRANCH_LOCATION'
    | 'OTHER';
  branchCode: string | null;
  labelAr: string;
  url: string;
  status: 'active' | 'inactive';
};

export type OfferItem = {
  id: number;
  key: string;
  titleAr: string;
  descriptionAr: string;
  branchCodes: string[];
  serviceIds: number[];
  validFrom: string | null;
  validTo: string | null;
  status: 'active' | 'inactive' | 'draft';
  priority: number;
};

export type BrandVoiceProfile = {
  dialect: 'egyptian' | 'egyptian_arabic';
  formality: 'warm_casual' | 'polite_relaxed' | 'formal' | 'neutral';
  warmth: number | 'high' | 'medium' | 'low';
  humor: number | 'light_contextual' | 'none';
  emojiUsage: 'none' | 'rare' | 'moderate' | 'low';
  messageLength: 'concise' | 'short' | 'medium';
  salesIntensity: 'none' | 'low' | 'medium' | 'help_first';
  greetingStyle: string;
  closingStyle: string;
  preferredAddressTerms: string[];
  bannedAddressTerms: string[];
  preferredPhrases: string[];
  bannedPhrases: string[];
  behaviorRules: string[];
};

export type VoiceExample = {
  id: number;
  scenarioKey: string;
  category: string;
  customerMessage: string;
  preferredResponse: string;
  notes: string | null;
  priority: number;
  isActive: boolean;
};

export type KnowledgeSourceRecord = {
  id: number;
  name: string;
  sourceType: string;
  urlOrRef: string | null;
  branchCode: string | null;
  active: boolean;
  lastReviewedAt: string | null;
  notes: string | null;
};

export type KnowledgeGap = {
  id?: number;
  normalizedSubject: string;
  categoryGuess: string | null;
  hitCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: 'open' | 'ignored' | 'resolved';
};

export type ConciergeAnswerSource =
  | 'LIVE_TOOL'
  | 'CURATED_KNOWLEDGE'
  | 'LINK'
  | 'CAPABILITY'
  | 'OFFER'
  | 'UNKNOWN'
  | 'NONE';

export type ConciergeIntent =
  | 'OPEN_NOW'
  | 'DIRECTIONS_MAPS'
  | 'EXTERNAL_LINK'
  | 'FAQ_KNOWLEDGE'
  | 'CAPABILITY_QUERY'
  | 'OFFER_QUERY'
  | 'SERVICE_PRICE_LIVE'
  | 'AVAILABILITY_LIVE'
  | 'HOURS_LIVE'
  | 'CONSULTATIVE'
  | 'UNKNOWN_KNOWLEDGE'
  | 'NONE';

export type MatchResolution = 'resolved' | 'ambiguous' | 'unknown';

export type ConciergeTrace = {
  version: 'concierge_v1';
  intent: ConciergeIntent;
  answerSource: ConciergeAnswerSource;
  knowledgeKeys: string[];
  knowledgeItemIds: number[];
  capabilityIds: number[];
  liveTools: string[];
  source: KnowledgeSource | 'none';
  recommendationReason: string | null;
  knowledgeGap: boolean;
  voiceExampleIds: number[];
  offerId: number | null;
  followUpUsed: boolean;
  mutatesBookingPlan: false;
};

export type ConciergeSnapshot = {
  knowledge: KnowledgeItem[];
  capabilities: CapabilityItem[];
  links: ExternalLinkItem[];
  offers: OfferItem[];
  brandVoice: BrandVoiceProfile;
  examples: VoiceExample[];
  sources: KnowledgeSourceRecord[];
  gaps: KnowledgeGap[];
};

export type ConciergeDecision = {
  handled: boolean;
  replyText: string | null;
  passToPhase2: boolean;
  bypassPlanner: boolean;
  blockBookingConfirm: boolean;
  mutatesBookingPlan: false;
  trace: ConciergeTrace;
};
