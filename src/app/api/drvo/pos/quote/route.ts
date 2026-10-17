import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { authorizeDrvoPosOperationalRead } from '@/platform/pos/authorizePosRead';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: object, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
});

/**
 * Staging-only server-side price preview. Never creates a sale or trusts
 * browser-provided prices. Tenant, location, service and employee are all
 * resolved from authoritative database rows.
 */
export async function POST(req: NextRequest) {
  const access = await authorizeDrvoPosOperationalRead();
  if (!access.ok) return json({ ok: false, code: access.code }, access.status);
  const origin = req.headers.get('origin');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const protocol = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.slice(0, -1);
  try {
    const parsed = origin ? new URL(origin) : null;
    if (!parsed || parsed.host !== host || parsed.protocol !== protocol + ':' ||
        parsed.username || parsed.password || req.headers.get('x-drvo-pos-quote-intent') !== '1') {
      return json({ ok: false, code: 'CSRF_DENIED' }, 403);
    }
  } catch { return json({ ok: false, code: 'CSRF_DENIED' }, 403); }
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return json({ ok: false, code: 'JSON_REQUIRED' }, 415);
  let serviceIds: number[];
  let employeeId: number;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, 'utf8') > 2048) return json({ ok: false, code: 'PAYLOAD_TOO_LARGE' }, 413);
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
    const data = body as Record<string, unknown>;
    if (Object.keys(data).sort().join(',') !== 'employeeId,serviceIds' ||
        !Array.isArray(data.serviceIds) || data.serviceIds.length < 1 ||
        data.serviceIds.length > 20 || !Number.isInteger(data.employeeId) ||
        Number(data.employeeId) <= 0) throw Error();
    serviceIds = data.serviceIds as number[];
    employeeId = data.employeeId as number;
    if (serviceIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(serviceIds).size !== serviceIds.length) throw Error();
  } catch { return json({ ok: false, code: 'INVALID_QUOTE_INPUT' }, 400); }

  try {
    const db = await getPool();
    const identity = await db.request().query<{ db: string }>('SELECT DB_NAME() AS db');
    if (identity.recordset[0]?.db !== 'last132_agent') return json({ ok: false, code: 'WRONG_DATABASE' }, 503);
    const context = access.context;
    const branch = context.activeLocation.legacyBranchId;
    const employee = await db.request()
      .input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .input('locationId', sql.UniqueIdentifier, context.activeLocation.locationId)
      .input('branchId', sql.Int, branch)
      .input('employeeId', sql.Int, employeeId)
      .query<{ EmpID: number; EmpName: string }>(`
        SELECT TOP (1) e.EmpID, e.EmpName FROM dbo.TblEmp e
        JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
          AND a.BranchID = @branchId AND a.IsActive = 1
          AND a.EffectiveFrom <= CONVERT(date, SYSDATETIME())
          AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CONVERT(date, SYSDATETIME()))
        JOIN dbo.Location l ON l.TenantId = e.TenantId
          AND l.LegacyBranchId = a.BranchID
          AND l.LocationId = @locationId AND l.Status = N'active'
        JOIN dbo.Tenant t ON t.TenantId = l.TenantId AND t.Status = N'active'
        WHERE e.TenantId = @tenantId AND e.EmpID = @employeeId
          AND ISNULL(e.isActive, 0) = 1 AND e.IsArchived = 0
      `);
    if (employee.recordset.length !== 1) return json({ ok: false, code: 'EMPLOYEE_NOT_AVAILABLE' }, 422);

    const request = db.request().input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .input('locationId', sql.UniqueIdentifier, context.activeLocation.locationId)
      .input('branchId', sql.Int, branch);
    serviceIds.forEach((id, index) => request.input('service' + index, sql.Int, id));
    const result = await request.query<{
      ProID: number; ProName: string | null; ProNameAr: string | null; SPrice1: number | null;
    }>(`
      SELECT p.ProID, p.ProName, p.ProNameAr, p.SPrice1
      FROM dbo.TblPro p
      WHERE p.TenantId = @tenantId AND ISNULL(p.isDeleted, 0) = 0
        AND p.ProID IN (${serviceIds.map((_, index) => '@service' + index).join(', ')})
        AND EXISTS (
          SELECT 1 FROM dbo.Location l
          JOIN dbo.Tenant t ON t.TenantId = l.TenantId AND t.Status = N'active'
          WHERE l.TenantId = @tenantId AND l.LocationId = @locationId
            AND l.LegacyBranchId = @branchId AND l.Status = N'active'
        )
    `);
    // An employee assigned to the branch may not perform every service.
    // Require an active per-service assignment for ALL quoted items.
    const eligibilityRequest = db.request()
      .input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .input('locationId', sql.UniqueIdentifier, context.activeLocation.locationId)
      .input('branchId', sql.Int, branch)
      .input('employeeId', sql.Int, employeeId);
    serviceIds.forEach((id, index) => eligibilityRequest.input('service' + index, sql.Int, id));
    const eligible = await eligibilityRequest.query<{ ProID: number }>(`
      SELECT DISTINCT es.ProID
      FROM dbo.TblEmpServiceSettings es
      JOIN dbo.TblEmp e ON e.EmpID = es.EmpID
        AND e.TenantId = @tenantId AND ISNULL(e.isActive, 0) = 1
        AND e.IsArchived = 0
      JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
        AND a.BranchID = @branchId AND a.IsActive = 1
        AND a.EffectiveFrom <= CONVERT(date, SYSDATETIME())
        AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CONVERT(date, SYSDATETIME()))
      JOIN dbo.Location l ON l.TenantId = e.TenantId
        AND l.LocationId = @locationId
        AND l.LegacyBranchId = a.BranchID AND l.Status = N'active'
      JOIN dbo.Tenant t ON t.TenantId = l.TenantId AND t.Status = N'active'
      JOIN dbo.TblPro p ON p.ProID = es.ProID
        AND p.TenantId = e.TenantId AND ISNULL(p.isDeleted, 0) = 0
      WHERE es.EmpID = @employeeId AND es.IsActive = 1
        AND es.ProID IN (${serviceIds.map((_, index) => '@service' + index).join(', ')})
    `);
    if (eligible.recordset.length !== serviceIds.length)
      return json({ ok: false, code: 'EMPLOYEE_SERVICE_NOT_AVAILABLE' }, 422);

    if (result.recordset.length !== serviceIds.length ||
        result.recordset.some(row => row.SPrice1 == null || !Number.isFinite(Number(row.SPrice1)) || Number(row.SPrice1) < 0))
      return json({ ok: false, code: 'SERVICE_OR_PRICE_NOT_AVAILABLE' }, 422);

    const lines = serviceIds.map(id => {
      const item = result.recordset.find(row => row.ProID === id)!;
      return { proId: id, name: item.ProNameAr || item.ProName || 'خدمة',
        unitPrice: Number(item.SPrice1) };
    });
    const subtotal = Math.round(lines.reduce((sum, line) => sum + line.unitPrice, 0) * 100) / 100;
    return json({
      ok: true, tenantId: context.tenantId, locationId: context.activeLocation.locationId,
      employee: { id: employeeId, name: employee.recordset[0].EmpName },
      lines, subtotal, indicativeTotal: subtotal, currency: 'EGP',
      quoteOnly: true, branchAvailabilityVerified: true,
      employeeServiceEligibilityVerified: true,
      discountsAndTaxApplied: false, writesEnabled: false,
    });
  } catch (error) {
    console.error('[drvo/pos/quote] unavailable', error instanceof Error ? error.name : 'unknown');
    return json({ ok: false, code: 'POS_QUOTE_UNAVAILABLE' }, 503);
  }
}
