/**
 * Ops Booking / Queue — deterministic popular + main-service catalog helpers.
 *
 * Strategy (safe across environments):
 * 1. Prefer configured/stable service IDs (env overrides; defaults from known CUT catalog).
 * 2. Fall back to exact AR/EN alias equality after normalize (never substring includes).
 * 3. Skip missing IDs/aliases silently — never invent a popular row.
 *
 * IDs are NOT assumed identical everywhere: aliases are the safety net when IDs differ.
 */

import { normalizeSearchText } from '@/lib/serviceSearch';

export type OpsPopularSlotKey = 'hair' | 'hair_beard' | 'beard';

export type OpsCatalogService = {
  ProID: number;
  ProName: string;
  /** English / alternate name when available from bootstrap. */
  ProNameEn?: string | null;
  SPrice?: number;
  DurationMinutes?: number | null;
  CatName?: string | null;
  CatID?: string | number | null;
};

export type OpsPopularSlotDef = {
  key: OpsPopularSlotKey;
  labelAr: string;
  /** Prefer these IDs when present in the loaded catalog. */
  preferredIds: readonly number[];
  /**
   * Exact display-name aliases (AR + EN). Matching is equality after normalize —
   * not includes() — to avoid false hits like "صبغة شعر ودقن" for hair+beard.
   */
  aliases: readonly string[];
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Defaults from production CUT catalog samples (serviceId 9 / 20 / 10).
 * Override per deploy: OPS_POPULAR_HAIR_SERVICE_ID, OPS_POPULAR_HAIR_BEARD_SERVICE_ID,
 * OPS_POPULAR_BEARD_SERVICE_ID (or reuse QUICK_QUEUE_SERVICE_ID for hair).
 */
export function getOpsPopularSlotDefs(): OpsPopularSlotDef[] {
  const hairId = envInt(
    'OPS_POPULAR_HAIR_SERVICE_ID',
    envInt('QUICK_QUEUE_SERVICE_ID', 9),
  );
  const hairBeardId = envInt('OPS_POPULAR_HAIR_BEARD_SERVICE_ID', 20);
  const beardId = envInt('OPS_POPULAR_BEARD_SERVICE_ID', 10);

  return [
    {
      key: 'hair',
      labelAr: 'حلاقة شعر',
      preferredIds: [hairId],
      aliases: [
        'حلاقة شعر',
        'حلاقه شعر',
        'قص شعر',
        'Hair Cut',
        'Haircut',
        'Basic Cut',
      ],
    },
    {
      key: 'hair_beard',
      labelAr: 'شعر ودقن',
      preferredIds: [hairBeardId],
      aliases: [
        'شعر ودقن',
        'شعر و دقن',
        'شعر وذقن',
        'شعر و ذقن',
        'Haircut & Beard',
        'Hair & Beard',
        'Hair cut & Beard',
        'Hair cut + Beard',
        'Hair and Beard',
      ],
    },
    {
      key: 'beard',
      labelAr: 'دقن',
      preferredIds: [beardId],
      aliases: [
        'دقن',
        'ذقن',
        'Beard',
        'Beard Styling',
        'Beard Styling & Fade',
      ],
    },
  ];
}

/** Normalize for exact alias equality (Arabic-aware via shared search normalizer). */
export function normalizeOpsServiceName(name: string): string {
  return normalizeSearchText(name)
    .replace(/\s+and\s+/g, ' ')
    .replace(/[&+]/g, ' ')
    // Unify "شعر و دقن" / "شعر ودقن" → "شعرودقن"
    .replace(/\s*و\s*/g, 'و')
    .replace(/\s+/g, ' ')
    .trim();
}

function serviceNameCandidates(s: OpsCatalogService): string[] {
  const out: string[] = [];
  if (s.ProName?.trim()) out.push(s.ProName);
  if (s.ProNameEn?.trim()) out.push(s.ProNameEn);
  return out;
}

function namesExactAliasMatch(service: OpsCatalogService, aliases: readonly string[]): boolean {
  const aliasNorms = aliases.map(normalizeOpsServiceName).filter(Boolean);
  if (!aliasNorms.length) return false;
  return serviceNameCandidates(service).some((n) => {
    const nn = normalizeOpsServiceName(n);
    return aliasNorms.some((a) => a === nn);
  });
}

/**
 * Resolve one popular slot against a loaded catalog.
 * Returns null when neither preferred ID nor exact alias matches.
 */
export function resolveOpsPopularSlot(
  services: readonly OpsCatalogService[],
  slot: OpsPopularSlotDef,
): OpsCatalogService | null {
  const visible = services.filter((s) => Boolean(s.ProName?.trim()) && (s.SPrice ?? 0) > 0);
  if (!visible.length) return null;

  for (const id of slot.preferredIds) {
    const byId = visible.find((s) => s.ProID === id);
    if (byId) return byId;
  }

  for (const s of visible) {
    if (namesExactAliasMatch(s, slot.aliases)) return s;
  }
  return null;
}

export type ResolvedOpsPopular = {
  key: OpsPopularSlotKey;
  labelAr: string;
  service: OpsCatalogService;
};

/**
 * Resolve configured popular slots in display order.
 * Omits slots that do not resolve — never returns placeholders.
 */
export function resolveOpsPopularServices(
  services: readonly OpsCatalogService[],
  defs: readonly OpsPopularSlotDef[] = getOpsPopularSlotDefs(),
): ResolvedOpsPopular[] {
  const out: ResolvedOpsPopular[] = [];
  const used = new Set<number>();
  for (const slot of defs) {
    const service = resolveOpsPopularSlot(services, slot);
    if (!service) continue;
    if (used.has(service.ProID)) continue;
    used.add(service.ProID);
    out.push({ key: slot.key, labelAr: slot.labelAr, service });
  }
  return out;
}

/** Secondary main cuts (not in popular strip, still "main" for selection rules). */
const SECONDARY_MAIN_ALIASES = [
  'Advanced Cut',
  'Fade Cut',
  'حلاقة فيد',
  'فيد',
  'قصة احترافية',
] as const;

/**
 * Main vs addon classification used by Booking workspace selection.
 * Extends legacy EN lists with AR aliases via exact normalize equality + popular slots.
 */
export function isOpsMainServiceName(name: string): boolean {
  const n = normalizeOpsServiceName(name);
  if (!n) return false;
  for (const slot of getOpsPopularSlotDefs()) {
    if (slot.aliases.some((a) => normalizeOpsServiceName(a) === n)) return true;
  }
  return SECONDARY_MAIN_ALIASES.some((a) => normalizeOpsServiceName(a) === n);
}

export function isOpsMainService(service: OpsCatalogService): boolean {
  return serviceNameCandidates(service).some((n) => isOpsMainServiceName(n));
}
