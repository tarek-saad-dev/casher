/**
 * Booking Phase 1 — central public booking branch context.
 * Single visibility + resolution contract for public booking APIs.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchByCode, listActiveBranches } from '@/lib/branch/repository';
import { isPubliclyDiscoverable } from '@/lib/branch/lifecycle';
import { canBranchAppearInPublicBooking } from '@/lib/branch/publicBranchVisibility';
import type { BranchLifecycleStatus, BranchRecord } from '@/lib/branch/types';
import {
  PUBLIC_BOOKING_ERROR_CATALOG,
  type PublicBookingErrorCode,
} from '@/lib/booking/publicBookingErrorCatalog';

export type PublicBookingPurpose =
  | 'public_discovery'
  | 'public_booking'
  | 'internal_preview';

export type PublicBookingBranchContext = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timezone: string;
  /** Included for internal_preview only — never serialize to public clients. */
  lifecycleStatus?: BranchLifecycleStatus;
  publicBookingEnabled: boolean;
  bookingEnabled: boolean;
  operatingHours: {
    openTime: string | null;
    closeTime: string | null;
  };
  businessDayCutoffTime: string | null;
};

export type InternalPreviewAuth = {
  userId: number;
  canManageSettings?: boolean;
  canOperate?: boolean;
};

export class PublicBookingBranchContextError extends Error {
  readonly code: PublicBookingErrorCode;
  readonly httpStatus: number;
  readonly technicalMessage: string;

  constructor(code: PublicBookingErrorCode) {
    const def = PUBLIC_BOOKING_ERROR_CATALOG[code];
    super(def.messageAr);
    this.name = 'PublicBookingBranchContextError';
    this.code = code;
    this.httpStatus = def.httpStatus;
    this.technicalMessage = def.messageEn;
  }
}

/** Route classification — branch-scoped vs global-capable. */
export const BRANCH_SCOPED_PUBLIC_BOOKING_ROUTES = [
  'config',
  'status',
  'services',
  'available-days',
  'available-slots',
  'check-slot',
  'plan',
  'create',
] as const;

export const GLOBAL_CAPABLE_PUBLIC_BOOKING_ROUTES = [
  'barbers',
  'barber-calendar',
] as const;

const BRANCH_CODE_RE = /^[A-Z][A-Z0-9_]{0,29}$/;

const CACHE_TTL_MS = 30_000;
const CACHE_MAX = 64;

type CacheEntry = {
  expiresAt: number;
  version: string;
  value: PublicBookingBranchContext;
};

const cacheRootKey = '__pos_public_booking_branch_ctx_v1';

function getCacheMap(): Map<string, CacheEntry> {
  const g = globalThis as typeof globalThis & {
    [cacheRootKey]?: Map<string, CacheEntry>;
  };
  if (!g[cacheRootKey]) g[cacheRootKey] = new Map();
  return g[cacheRootKey]!;
}

function cacheKey(branchCode: string, purpose: PublicBookingPurpose, version: string): string {
  return `${purpose}::${branchCode}::${version}`;
}

function buildVersion(branch: BranchRecord, bookingEnabled: boolean): string {
  return [
    branch.lifecycleStatus,
    branch.isActive ? '1' : '0',
    branch.publicBookingEnabled ? '1' : '0',
    bookingEnabled ? '1' : '0',
    branch.updatedAt?.toISOString?.() ?? '',
    branch.defaultOpenTime ?? '',
    branch.defaultCloseTime ?? '',
    branch.address ?? '',
    branch.phone ?? '',
    branch.timeZone ?? '',
  ].join('|');
}

export function invalidatePublicBookingBranchContextCache(branchCode?: string): void {
  const map = getCacheMap();
  if (!branchCode) {
    map.clear();
    return;
  }
  const code = branchCode.trim().toUpperCase();
  for (const key of map.keys()) {
    if (key.includes(`::${code}::`)) map.delete(key);
  }
}

/**
 * Normalize public branchCode: trim, uppercase, underscore-safe.
 * Rejects empty, numeric-only BranchID spoofs, and malformed codes.
 */
export function normalizePublicBranchCode(raw: string | null | undefined): string {
  if (raw == null) {
    throw new PublicBookingBranchContextError('BRANCH_REQUIRED');
  }
  const trimmed = String(raw).trim();
  if (!trimmed) {
    throw new PublicBookingBranchContextError('BRANCH_REQUIRED');
  }
  if (/^\d+$/.test(trimmed)) {
    throw new PublicBookingBranchContextError('INVALID_BRANCH_CODE');
  }
  const normalized = trimmed.toUpperCase();
  if (!BRANCH_CODE_RE.test(normalized)) {
    throw new PublicBookingBranchContextError('INVALID_BRANCH_CODE');
  }
  return normalized;
}

export function tryNormalizePublicBranchCode(
  raw: string | null | undefined,
): { ok: true; code: string } | { ok: false; error: PublicBookingBranchContextError } {
  try {
    return { ok: true, code: normalizePublicBranchCode(raw) };
  } catch (e) {
    if (e instanceof PublicBookingBranchContextError) return { ok: false, error: e };
    throw e;
  }
}

async function loadQueueBookingEnabled(branchId: number): Promise<boolean> {
  const db = await getPool();
  const qbs = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 ISNULL(BookingEnabled, 0) AS BookingEnabled
      FROM dbo.QueueBookingSettings WHERE BranchID = @branchId
    `);
  return Boolean(qbs.recordset[0]?.BookingEnabled);
}

function toPublicContext(
  branch: BranchRecord,
  bookingEnabled: boolean,
  purpose: PublicBookingPurpose,
): PublicBookingBranchContext {
  const base: PublicBookingBranchContext = {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    shortName: branch.shortName,
    address: branch.address,
    phone: branch.phone,
    timezone: branch.timeZone,
    publicBookingEnabled: branch.publicBookingEnabled,
    bookingEnabled,
    operatingHours: {
      openTime: branch.defaultOpenTime,
      closeTime: branch.defaultCloseTime,
    },
    businessDayCutoffTime: branch.businessDayCutoffTime || null,
  };
  if (purpose === 'internal_preview') {
    base.lifecycleStatus = branch.lifecycleStatus;
  }
  return base;
}

/** Safe public list row — no lifecycle / internal flags. */
export type PublicDiscoverableBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
};

/**
 * Branches that may appear in GET /api/public/branches.
 * Requires PUBLIC_LIVE + IsActive + PublicBookingEnabled + QBS.BookingEnabled.
 */
export async function listPublicDiscoverableBranches(): Promise<PublicDiscoverableBranch[]> {
  const active = await listActiveBranches();
  const out: PublicDiscoverableBranch[] = [];
  for (const b of active) {
    if (!(await canBranchAppearInPublicBooking(b.branchId))) continue;
    out.push({
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
      shortName: b.shortName,
      address: b.address,
      phone: b.phone,
      timeZone: b.timeZone,
    });
  }
  return out;
}

/**
 * Central resolver. Never falls back to GLEEM when branchCode is missing.
 * public_discovery / public_booking: no auth.
 * internal_preview: requires authorized auth context (never query-param alone).
 */
export async function resolvePublicBookingBranchContext(args: {
  branchCode?: string | null;
  purpose: PublicBookingPurpose;
  /** Required when purpose === internal_preview */
  auth?: InternalPreviewAuth | null;
  /** Rejected — must not enable internal_preview */
  previewQueryParam?: string | null;
}): Promise<PublicBookingBranchContext> {
  if (args.previewQueryParam != null && String(args.previewQueryParam).length > 0) {
    // Query-param preview must never escalate privileges.
    if (args.purpose === 'internal_preview' && !args.auth?.userId) {
      throw new PublicBookingBranchContextError('BRANCH_NOT_PUBLIC');
    }
  }

  if (args.purpose === 'internal_preview') {
    const auth = args.auth;
    if (!auth?.userId || !(auth.canManageSettings || auth.canOperate)) {
      throw new PublicBookingBranchContextError('BRANCH_NOT_PUBLIC');
    }
  }

  const code = normalizePublicBranchCode(args.branchCode);
  const branch = await getBranchByCode(code);
  if (!branch) {
    throw new PublicBookingBranchContextError('BRANCH_NOT_FOUND');
  }

  const bookingEnabled = await loadQueueBookingEnabled(branch.branchId);
  const version = buildVersion(branch, bookingEnabled);
  const key = cacheKey(code, args.purpose, version);
  const map = getCacheMap();
  const hit = map.get(key);
  if (hit && hit.expiresAt > Date.now() && hit.version === version) {
    return hit.value;
  }

  if (args.purpose === 'public_discovery' || args.purpose === 'public_booking') {
    if (
      !isPubliclyDiscoverable({
        lifecycleStatus: branch.lifecycleStatus,
        publicBookingEnabled: branch.publicBookingEnabled,
        isActive: branch.isActive,
      })
    ) {
      throw new PublicBookingBranchContextError('BRANCH_NOT_PUBLIC');
    }
    // All-four for discovery-style "appear"; booking routes may still return
    // paused config when QBS is off (GLEEM compatibility) via bookingEnabled flag.
    if (args.purpose === 'public_discovery' && !bookingEnabled) {
      throw new PublicBookingBranchContextError('BRANCH_NOT_PUBLIC');
    }
  }
  // internal_preview: any existing branch is allowed once authorized

  const ctx = toPublicContext(branch, bookingEnabled, args.purpose);

  if (map.size >= CACHE_MAX) {
    const first = map.keys().next().value;
    if (first) map.delete(first);
  }
  map.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, version, value: ctx });
  return ctx;
}

/** Public JSON without branchId/lifecycle for wire responses where IDs are undesirable. */
export function toPublicBranchWire(ctx: PublicBookingBranchContext): {
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
} {
  return {
    branchCode: ctx.branchCode,
    branchName: ctx.branchName,
    shortName: ctx.shortName,
    address: ctx.address,
    phone: ctx.phone,
    timeZone: ctx.timezone,
  };
}

/** Keep branchId for existing widget contract on config (GLEEM compatibility). */
export function toPublicBranchSafeWire(ctx: PublicBookingBranchContext): {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
} {
  return {
    branchId: ctx.branchId,
    branchCode: ctx.branchCode,
    branchName: ctx.branchName,
    shortName: ctx.shortName,
    address: ctx.address,
    phone: ctx.phone,
    timeZone: ctx.timezone,
  };
}
