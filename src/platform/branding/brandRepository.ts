import 'server-only';
import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import type { SqlExecutor } from '@/platform/commercial/planRepository';
import { publishPlatformOutboxEvent } from '@/platform/outbox/publisher';
import { TenantScopedMemo } from '@/platform/tenant/tenantMemo';
import type { TenantBrandProfile, TenantBrandProfileInput } from './brandProfile';

export class BrandProfileError extends Error {
  constructor(
    readonly code: 'TENANT_NOT_FOUND' | 'REVISION_CONFLICT',
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'BrandProfileError';
  }
}

const brandMemo = new TenantScopedMemo<TenantBrandProfile>('tenant-brand', 30_000);

export function invalidateTenantBrand(tenantId: string): void {
  brandMemo.invalidateTenant(tenantId);
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function parseOrigins(raw: unknown): string[] {
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function mapRow(row: Record<string, unknown>): TenantBrandProfile {
  return {
    tenantId: String(row.TenantId).toLowerCase(),
    displayName: String(row.DisplayName),
    logoUrl: row.LogoUrl != null ? String(row.LogoUrl) : null,
    phone: row.Phone != null ? String(row.Phone) : null,
    address: row.Address != null ? String(row.Address) : null,
    primaryColor: row.PrimaryColor != null ? String(row.PrimaryColor) : null,
    accentColor: row.AccentColor != null ? String(row.AccentColor) : null,
    receiptFooter: row.ReceiptFooter != null ? String(row.ReceiptFooter) : null,
    timezone: String(row.Timezone),
    publicBookingOrigins: parseOrigins(row.PublicBookingOrigins),
    revision: Number(row.Revision ?? 1),
    updatedAt: iso(row.UpdatedAt),
  };
}

/**
 * Brand profile for an authoritative tenant. A tenant without a row (pre-migration-11 data that
 * the backfill has not reached) renders a neutral profile from its own Tenant row — never another
 * tenant's brand and never a hardcoded product brand.
 */
export async function loadTenantBrandProfile(
  tenantId: string,
  opts: { executor?: SqlExecutor } = {},
): Promise<TenantBrandProfile | null> {
  const ex = opts.executor ?? (await getPool());
  const result = await ex
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT t.TenantId, t.Name, t.DefaultTimezone,
             b.TenantId AS BrandTenantId, b.DisplayName, b.LogoUrl, b.Phone, b.Address,
             b.PrimaryColor, b.AccentColor, b.ReceiptFooter, b.Timezone,
             b.PublicBookingOrigins, b.Revision, b.UpdatedAt
      FROM dbo.Tenant t
      LEFT JOIN dbo.TenantBrandProfile b ON b.TenantId = t.TenantId
      WHERE t.TenantId = @tenantId;
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  if (row.BrandTenantId == null) {
    return {
      tenantId: String(row.TenantId).toLowerCase(),
      displayName: String(row.Name),
      logoUrl: null,
      phone: null,
      address: null,
      primaryColor: null,
      accentColor: null,
      receiptFooter: null,
      timezone: String(row.DefaultTimezone),
      publicBookingOrigins: [],
      revision: 0,
      updatedAt: null,
    };
  }
  return mapRow(row);
}

export async function getTenantBrandProfileCached(tenantId: string): Promise<TenantBrandProfile | null> {
  const hit = brandMemo.get(tenantId);
  if (hit) return hit;
  const profile = await loadTenantBrandProfile(tenantId);
  if (profile) brandMemo.set(tenantId, [], profile);
  return profile;
}

/** Insert-only brand row written inside the onboarding transaction. */
export async function insertTenantBrandProfileInTransaction(
  tx: Transaction,
  tenantId: string,
  input: TenantBrandProfileInput,
  actorUserId: number,
): Promise<void> {
  await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('displayName', sql.NVarChar(128), input.displayName)
    .input('logoUrl', sql.NVarChar(512), input.logoUrl ?? null)
    .input('phone', sql.NVarChar(40), input.phone ?? null)
    .input('address', sql.NVarChar(256), input.address ?? null)
    .input('primaryColor', sql.NVarChar(7), input.primaryColor ?? null)
    .input('accentColor', sql.NVarChar(7), input.accentColor ?? null)
    .input('receiptFooter', sql.NVarChar(256), input.receiptFooter ?? null)
    .input('timezone', sql.NVarChar(64), input.timezone)
    .input('origins', sql.NVarChar(2000), JSON.stringify(input.publicBookingOrigins ?? []))
    .input('actor', sql.Int, actorUserId > 0 ? actorUserId : null)
    .query(`
      INSERT INTO dbo.TenantBrandProfile (
        TenantId, DisplayName, LogoUrl, Phone, Address, PrimaryColor, AccentColor,
        ReceiptFooter, Timezone, PublicBookingOrigins, UpdatedByUserId
      )
      VALUES (
        @tenantId, @displayName, @logoUrl, @phone, @address, @primaryColor, @accentColor,
        @receiptFooter, @timezone, @origins, @actor
      );
    `);
}

/**
 * Replace the editable brand fields for one tenant (optimistic concurrency on Revision).
 * The tenantId always comes from the caller's authoritative context, never from the body.
 */
export async function saveTenantBrandProfile(
  tenantId: string,
  input: TenantBrandProfileInput,
  opts: { actorUserId: number; expectedRevision?: number; source: 'tenant_admin' | 'platform_operator' },
): Promise<TenantBrandProfile> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const current = await new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT t.TenantId, b.Revision
        FROM dbo.Tenant t WITH (UPDLOCK, HOLDLOCK)
        LEFT JOIN dbo.TenantBrandProfile b WITH (UPDLOCK, HOLDLOCK) ON b.TenantId = t.TenantId
        WHERE t.TenantId = @tenantId;
      `);
    const row = current.recordset[0] as { TenantId: string; Revision: number | null } | undefined;
    if (!row) throw new BrandProfileError('TENANT_NOT_FOUND', 'Tenant not found', 404);
    const currentRevision = row.Revision == null ? 0 : Number(row.Revision);
    if (opts.expectedRevision !== undefined && opts.expectedRevision !== currentRevision) {
      throw new BrandProfileError(
        'REVISION_CONFLICT',
        'Brand profile was changed by someone else; reload and retry.',
        409,
      );
    }

    const req = new sql.Request(tx)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('displayName', sql.NVarChar(128), input.displayName)
      .input('logoUrl', sql.NVarChar(512), input.logoUrl ?? null)
      .input('phone', sql.NVarChar(40), input.phone ?? null)
      .input('address', sql.NVarChar(256), input.address ?? null)
      .input('primaryColor', sql.NVarChar(7), input.primaryColor ?? null)
      .input('accentColor', sql.NVarChar(7), input.accentColor ?? null)
      .input('receiptFooter', sql.NVarChar(256), input.receiptFooter ?? null)
      .input('timezone', sql.NVarChar(64), input.timezone)
      .input('origins', sql.NVarChar(2000), JSON.stringify(input.publicBookingOrigins ?? []))
      .input('actor', sql.Int, opts.actorUserId > 0 ? opts.actorUserId : null);
    if (row.Revision == null) {
      await req.query(`
        INSERT INTO dbo.TenantBrandProfile (
          TenantId, DisplayName, LogoUrl, Phone, Address, PrimaryColor, AccentColor,
          ReceiptFooter, Timezone, PublicBookingOrigins, UpdatedByUserId
        )
        VALUES (
          @tenantId, @displayName, @logoUrl, @phone, @address, @primaryColor, @accentColor,
          @receiptFooter, @timezone, @origins, @actor
        );
      `);
    } else {
      await req.query(`
        UPDATE dbo.TenantBrandProfile
        SET DisplayName = @displayName, LogoUrl = @logoUrl, Phone = @phone, Address = @address,
            PrimaryColor = @primaryColor, AccentColor = @accentColor, ReceiptFooter = @receiptFooter,
            Timezone = @timezone, PublicBookingOrigins = @origins,
            Revision = Revision + 1, UpdatedAt = SYSUTCDATETIME(), UpdatedByUserId = @actor
        WHERE TenantId = @tenantId;
      `);
    }

    const nextRevision = currentRevision + 1;
    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType: 'tenant_brand',
      aggregateId: tenantId,
      eventType: 'tenant.brand.updated',
      payload: JSON.stringify({
        revision: nextRevision,
        source: opts.source,
        actorUserId: opts.actorUserId,
        displayName: input.displayName,
      }),
      idempotencyKey: `tenant-brand:${tenantId}:rev:${nextRevision}`,
      correlationId: `tenant-brand:${tenantId}`,
    });

    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
  invalidateTenantBrand(tenantId);
  const saved = await loadTenantBrandProfile(tenantId);
  if (!saved) throw new BrandProfileError('TENANT_NOT_FOUND', 'Tenant not found', 404);
  return saved;
}
