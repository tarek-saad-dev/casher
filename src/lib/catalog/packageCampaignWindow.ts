/**
 * Optional campaign window embedded in TblServicePackage.NotesAr.
 * Packages without this marker stay continuously bookable (subject to isDeleted).
 *
 * Marker format (compact, ASCII):
 *   [campaign:code=NOV-PRO600;from=2026-11-01;to=2026-11-30;tz=Africa/Cairo]
 */
export type PackageCampaignWindow = {
  code: string;
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  timezone: string;
};

const CAMPAIGN_RE =
  /\[campaign:code=([^;\]]+);from=(\d{4}-\d{2}-\d{2});to=(\d{4}-\d{2}-\d{2});tz=([^;\]]+)\]/i;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function formatPackageCampaignMarker(window: PackageCampaignWindow): string {
  return `[campaign:code=${window.code};from=${window.from};to=${window.to};tz=${window.timezone}]`;
}

export function parsePackageCampaignWindow(
  notesAr: string | null | undefined,
): PackageCampaignWindow | null {
  if (!notesAr) return null;
  const m = notesAr.match(CAMPAIGN_RE);
  if (!m) return null;
  const code = String(m[1] ?? '').trim();
  const from = String(m[2] ?? '').trim();
  const to = String(m[3] ?? '').trim();
  const timezone = String(m[4] ?? '').trim() || 'Africa/Cairo';
  if (!code || !YMD_RE.test(from) || !YMD_RE.test(to) || from > to) return null;
  return { code, from, to, timezone };
}

/** Inclusive calendar-date check (plain YYYY-MM-DD, no timezone conversion). */
export function isDateInsidePackageCampaign(
  window: PackageCampaignWindow | null | undefined,
  ymd: string,
): boolean {
  if (!window) return true;
  if (!YMD_RE.test(ymd)) return false;
  return ymd >= window.from && ymd <= window.to;
}

/**
 * Whether the package should appear in catalogs for "today".
 * No window → always offered (when not soft-deleted).
 */
export function isPackageOfferedOnDate(
  notesAr: string | null | undefined,
  ymd: string,
): boolean {
  return isDateInsidePackageCampaign(parsePackageCampaignWindow(notesAr), ymd);
}

const SEED_CODE_RE = /\[seed:([A-Za-z0-9_-]+)\]/;

/**
 * Public package SKU from NotesAr seed marker (e.g. NOV-PRO600).
 * Prefer campaign.code when present; otherwise the seed key.
 */
export function extractPackagePublicCode(notesAr: string | null | undefined): string | null {
  const campaign = parsePackageCampaignWindow(notesAr);
  if (campaign?.code) return campaign.code;
  if (!notesAr) return null;
  const m = notesAr.match(SEED_CODE_RE);
  const key = m?.[1]?.trim();
  return key || null;
}
