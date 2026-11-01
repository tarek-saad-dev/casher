export const CAMPAIGN_STATUSES = [
  'draft',
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
  'paused',
] as const;

export const CAMPAIGN_MESSAGE_MODES = ['template', 'custom'] as const;

export const NOV_PRO600_SEGMENTS = ['VIP', 'HAIR_CARE', 'HAIRCUT_REGULAR'] as const;
export type NovPro600Segment = (typeof NOV_PRO600_SEGMENTS)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  'pending',
  'queued',
  'sent',
  'failed',
  'cancelled',
  'skipped',
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type CampaignMessageMode = (typeof CAMPAIGN_MESSAGE_MODES)[number];
export type CampaignRecipientStatus = (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export type AudienceRule = {
  city?: string;
  cameFrom?: string;
  maritalStatus?: string;
  minVisits?: number;
  minSpend?: number;
  lastVisitFrom?: string;
  lastVisitTo?: string;
};

export type AudienceCriteria = {
  /** Port of bot offerAudienceBuilder + legacy segments + NOV-PRO600 presets */
  mode: 'all' | 'rules' | 'segment' | 'nov_pro600';
  segmentType?: 'today' | 'this_week' | 'two_weeks' | 'one_month';
  /** NOV-PRO600 presets (VIP / HAIR_CARE / HAIRCUT_REGULAR). Empty = all three. */
  novPro600Segments?: NovPro600Segment[];
  /** Optional as-of date (YYYY-MM-DD). Defaults to campaign window start. */
  asOfDate?: string;
  branchId?: number;
  minAge?: number;
  maxAge?: number;
  notVisitedSinceDays?: number;
  rules?: AudienceRule[];
};

export type CampaignErrorCode =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INVALID_STATUS'
  | 'EMPTY_AUDIENCE'
  | 'INVALID_MESSAGE'
  | 'SERIALIZATION_FAILED'
  | 'CONSENT_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'TEST_PHONE_DENIED';

export class CampaignError extends Error {
  readonly code: CampaignErrorCode;
  readonly status: number;

  constructor(message: string, code: CampaignErrorCode, status = 400) {
    super(message);
    this.name = 'CampaignError';
    this.code = code;
    this.status = status;
  }
}

export type CampaignRow = {
  id: number;
  name: string;
  status: CampaignStatus;
  messageMode: CampaignMessageMode;
  templateKey: string | null;
  customMessage: string | null;
  audienceJson: string;
  branchId: number | null;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  createdByUserId: number | null;
  createdAt: string;
  scheduledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  lastError: string | null;
};

export type CampaignRecipientRow = {
  id: number;
  campaignId: number;
  customerId: number | null;
  customerName: string | null;
  phone: string;
  messageContent: string;
  idempotencyKey: string;
  outboxMessageId: number | null;
  status: CampaignRecipientStatus;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type AudienceMember = {
  clientId: number;
  phone: string;
  name: string;
  firstName?: string;
  branchName?: string | null;
  visitCount: number;
  totalSpend: number;
  lastVisitDate: string | null;
  segment?: NovPro600Segment;
  sendEligible?: boolean;
  consentEvidence?: string | null;
  exclusionReason?: string | null;
};

export type CreateCampaignInput = {
  name: string;
  messageMode: CampaignMessageMode;
  templateKey?: string | null;
  customMessage?: string | null;
  audience: AudienceCriteria;
  branchId?: number | null;
  scheduledAt?: string | null;
  createdByUserId: number;
};

export type CampaignProgress = {
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
  pendingCount: number;
  queuedCount: number;
  cancelledCount: number;
  skippedCount: number;
};

export type CampaignDetail = CampaignRow & {
  audience: AudienceCriteria;
  progress: CampaignProgress;
  recipientSummary: Record<CampaignRecipientStatus, number>;
};

export const WHATSAPP_CAMPAIGN_TEMPLATE_KEY = 'whatsapp.campaign' as const;

export function serializeAudienceCriteria(audience: AudienceCriteria): string {
  return JSON.stringify(audience);
}

export function parseAudienceCriteria(json: string): AudienceCriteria {
  try {
    const parsed = JSON.parse(json) as AudienceCriteria;
    if (!parsed || typeof parsed !== 'object' || !parsed.mode) {
      throw new Error('invalid audience');
    }
    if (!['all', 'rules', 'segment', 'nov_pro600'].includes(parsed.mode)) {
      throw new Error('invalid audience mode');
    }
    if (parsed.mode === 'nov_pro600' && parsed.novPro600Segments) {
      parsed.novPro600Segments = parsed.novPro600Segments.filter((s) =>
        (NOV_PRO600_SEGMENTS as readonly string[]).includes(s),
      ) as NovPro600Segment[];
    }
    return parsed;
  } catch {
    throw new CampaignError('بيانات الجمهور غير صالحة', 'SERIALIZATION_FAILED');
  }
}

export function isNovPro600Segment(value: unknown): value is NovPro600Segment {
  return typeof value === 'string' && (NOV_PRO600_SEGMENTS as readonly string[]).includes(value);
}

export function buildRecipientIdempotencyKey(
  campaignId: number,
  customerId: number | null,
  normalizedPhone: string,
): string {
  const recipientPart =
    typeof customerId === 'number' && Number.isFinite(customerId)
      ? String(customerId)
      : normalizedPhone;
  return `campaign:${campaignId}:recipient:${recipientPart}`;
}

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return typeof value === 'string' && (CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

export function isCampaignMessageMode(value: unknown): value is CampaignMessageMode {
  return typeof value === 'string' && (CAMPAIGN_MESSAGE_MODES as readonly string[]).includes(value);
}
