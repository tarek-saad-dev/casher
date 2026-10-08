import { getPool, sql } from '@/lib/db';
import { TenantScopedMemo } from '@/platform/tenant/tenantMemo';
import { requireMessagingTenantId } from './messagingTenantScope';

/** Opening hours of one location as the assistant should state them. */
export interface TenantAiLocationHours {
  branchCode: string;
  displayName: string;
  shortName: string;
  /** Minutes after local midnight. */
  openMinutes: number;
  closeMinutes: number;
  /** 1 when closing time falls after midnight. */
  closeDayOffset: 0 | 1;
  scheduleLabel: string;
  openLabel: string;
  closeLabel: string;
}

/**
 * Tenant AI receptionist profile (TenantAiConfig). Industry-neutral: the business name, persona
 * phrase, URLs, hours and policies are data. `conversationPack` opts a tenant into an
 * industry-specific conversation pack; null means the generic receptionist path only.
 */
export interface TenantAiConfig {
  tenantId: string;
  enabled: boolean;
  industryCode: string;
  businessName: string;
  assistantPersona: string;
  locale: string;
  websiteUrl: string | null;
  bookingUrl: string | null;
  pricesUrl: string | null;
  locationHours: TenantAiLocationHours[];
  policies: string[];
  bookingActorUserId: number | null;
  conversationPack: string | null;
  revision: number;
}

/** CUT-tuned salon concierge pack (Arabic barbershop flows). Opt-in per tenant. */
export const SALON_CONCIERGE_PACK = 'salon-concierge-v1';

type RawConfig = {
  TenantId: string;
  Enabled: boolean | number;
  IndustryCode: string;
  BusinessName: string;
  AssistantPersona: string;
  Locale: string;
  WebsiteUrl: string | null;
  BookingUrl: string | null;
  PricesUrl: string | null;
  BusinessHoursJson: string | null;
  PoliciesJson: string | null;
  BookingActorUserId: number | null;
  ConversationPack: string | null;
  Revision: number;
};

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toLocationHours(value: unknown): TenantAiLocationHours | null {
  const v = value as Record<string, unknown>;
  if (!v || typeof v.branchCode !== 'string') return null;
  const open = Number(v.openMinutes);
  const close = Number(v.closeMinutes);
  if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
  return {
    branchCode: v.branchCode,
    displayName: String(v.displayName ?? v.branchCode),
    shortName: String(v.shortName ?? v.displayName ?? v.branchCode),
    openMinutes: open,
    closeMinutes: close,
    closeDayOffset: Number(v.closeDayOffset) === 1 ? 1 : 0,
    scheduleLabel: String(v.scheduleLabel ?? ''),
    openLabel: String(v.openLabel ?? ''),
    closeLabel: String(v.closeLabel ?? ''),
  };
}

export function mapTenantAiConfig(row: RawConfig): TenantAiConfig {
  return {
    tenantId: String(row.TenantId).toLowerCase(),
    enabled: row.Enabled === true || row.Enabled === 1,
    industryCode: String(row.IndustryCode),
    businessName: String(row.BusinessName),
    assistantPersona: String(row.AssistantPersona),
    locale: String(row.Locale || 'ar-EG'),
    websiteUrl: row.WebsiteUrl ?? null,
    bookingUrl: row.BookingUrl ?? null,
    pricesUrl: row.PricesUrl ?? null,
    locationHours: parseJsonArray(row.BusinessHoursJson)
      .map(toLocationHours)
      .filter((h): h is TenantAiLocationHours => h !== null),
    policies: parseJsonArray(row.PoliciesJson).filter((p): p is string => typeof p === 'string'),
    bookingActorUserId:
      row.BookingActorUserId == null || !Number.isInteger(Number(row.BookingActorUserId))
        ? null
        : Number(row.BookingActorUserId),
    conversationPack: row.ConversationPack ? String(row.ConversationPack) : null,
    revision: Number(row.Revision ?? 1),
  };
}

async function loadFromSql(tenantId: string): Promise<TenantAiConfig | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TenantId, Enabled, IndustryCode, BusinessName, AssistantPersona, Locale,
             WebsiteUrl, BookingUrl, PricesUrl, BusinessHoursJson, PoliciesJson,
             BookingActorUserId, ConversationPack, Revision
      FROM dbo.TenantAiConfig
      WHERE TenantId = @tenantId;
    `);
  const row = result.recordset[0] as RawConfig | undefined;
  return row ? mapTenantAiConfig(row) : null;
}

const memo = new TenantScopedMemo<TenantAiConfig | null>('messaging-ai-config', 30_000);
let loader: (tenantId: string) => Promise<TenantAiConfig | null> = loadFromSql;

/** Test seam (pass null to restore SQL). */
export function setTenantAiConfigLoaderForTests(
  next: ((tenantId: string) => Promise<TenantAiConfig | null>) | null,
): void {
  loader = next ?? loadFromSql;
  memo.clear();
}

/** AI profile of the current messaging tenant; null when the tenant has no AI configuration. */
export async function getCurrentTenantAiConfig(): Promise<TenantAiConfig | null> {
  const tenantId = requireMessagingTenantId('getCurrentTenantAiConfig');
  return memo.getOrLoad(tenantId, ['config'], () => loader(tenantId));
}

/** Current tenant AI profile, or throws when AI is not configured/enabled for the tenant. */
export async function requireCurrentTenantAiConfig(): Promise<TenantAiConfig> {
  const config = await getCurrentTenantAiConfig();
  if (!config || !config.enabled) {
    throw new TenantAiNotConfiguredError();
  }
  return config;
}

export class TenantAiNotConfiguredError extends Error {
  readonly code = 'AI_NOT_CONFIGURED';
  constructor() {
    super('AI receptionist is not configured or disabled for this tenant');
    this.name = 'TenantAiNotConfiguredError';
  }
}

export function usesSalonConciergePack(config: TenantAiConfig | null | undefined): boolean {
  return config?.conversationPack === SALON_CONCIERGE_PACK;
}
