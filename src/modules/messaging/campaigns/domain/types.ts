export const CAMPAIGN_STATUSES = [
  'draft',
  'queued',
  'running',
  'completed',
  'cancelled',
  'failed',
] as const;

export const CAMPAIGN_MESSAGE_MODES = ['template', 'custom'] as const;

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
  /** Port of bot offerAudienceBuilder + legacy segments */
  mode: 'all' | 'rules' | 'segment';
  segmentType?: 'today' | 'this_week' | 'two_weeks' | 'one_month';
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
  | 'SERIALIZATION_FAILED';

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
  visitCount: number;
  totalSpend: number;
  lastVisitDate: string | null;
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
    return parsed;
  } catch {
    throw new CampaignError('بيانات الجمهور غير صالحة', 'SERIALIZATION_FAILED');
  }
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
