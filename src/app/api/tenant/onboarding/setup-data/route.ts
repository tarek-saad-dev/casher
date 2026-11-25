import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin, type AuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { updateBranchSetupFields } from '@/lib/branch/updateBranchSetup';
import { assertLegacyBranchInTenant } from '@/platform/tenant/tenantContext';
import { getTenantInstalledAppsForGate } from '@/platform/commercial/tenantAccessGate';
import { runServicesStage, runTeamStage, type OnboardingSetupContext } from '@/platform/onboarding/wizard/setupStages';
import { isPublicSalonSetupTenant } from '@/platform/onboarding/selfServiceEligibility';
import { parseSetupAction, SetupInputError } from '@/platform/onboarding/selfServiceInput';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

function reply(body: object, status = 200) {
  return NextResponse.json(body, { status, headers });
}

/** Public registration membership is checked in SQL, not by a client flag or a code prefix. */
async function setupTarget(auth: AuthResult) {
  if (!(await isPublicSalonSetupTenant(auth.tenantId, auth.tenant.tenantCode))) return null;
  const pool = await getPool();
  await assertLegacyBranchInTenant(auth.tenantId, auth.activeBranchId);
  const branch = await getBranchById(auth.activeBranchId);
  if (!branch) return null;
  return { pool, branch };
}

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const target = await setupTarget(auth);
    if (!target) return reply({ ok: true, editable: false });
    const { pool, branch } = target;
    const [services, employees] = await Promise.all([
      pool.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId).query(`
        SELECT ProID, ProName, SPrice1, DurationMinutes FROM dbo.TblPro
        WHERE TenantId = @tenantId AND ISNULL(isDeleted, 0) = 0
        ORDER BY ProID;
      `),
      pool.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId)
        .input('branchId', sql.Int, auth.activeBranchId).query(`
        SELECT e.EmpID, e.EmpName, e.Job FROM dbo.TblEmp e
        WHERE e.TenantId = @tenantId AND ISNULL(e.isActive, 1) = 1
        AND EXISTS (
          SELECT 1 FROM dbo.TblEmpBranchAssignment a
          WHERE a.EmpID = e.EmpID AND a.BranchID = @branchId AND a.IsActive = 1
            AND a.EffectiveFrom <= CAST(GETUTCDATE() AS date)
            AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(GETUTCDATE() AS date))
        )
        ORDER BY e.EmpID;
      `),
    ]);
    return reply({
      ok: true, editable: true,
      branch: {
        name: branch.branchName, address: branch.address ?? '', phone: branch.phone ?? '',
        defaultOpenTime: branch.defaultOpenTime?.slice(0, 5) ?? '',
        defaultCloseTime: branch.defaultCloseTime?.slice(0, 5) ?? '',
      },
      services: services.recordset,
      employees: employees.recordset,
    });
  } catch (err) {
    console.error('[tenant/onboarding/setup-data] read failed', err);
    return reply({ error: 'تعذر تحميل بيانات التجهيز.' }, 500);
  }
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  // Browser JSON only, with same-origin requests. No cross-site credentialed writes.
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json') ||
      req.headers.get('sec-fetch-site') === 'cross-site') {
    return reply({ error: 'طلب غير صالح.' }, 415);
  }
  try {
    const action = parseSetupAction(await req.json().catch(() => null));
    const target = await setupTarget(auth);
    if (!target) return reply({ error: 'التجهيز المباشر غير متاح لهذا الحساب.' }, 403);

    if (action.action === 'branch') {
      await updateBranchSetupFields({
        branchId: auth.activeBranchId, address: action.address, phone: action.phone,
        defaultOpenTime: action.defaultOpenTime, defaultCloseTime: action.defaultCloseTime,
        requireSetupLifecycle: false, actorUserId: auth.userId, reason: 'self-service salon setup',
      });
      return reply({ ok: true, created: 0, existing: 0 });
    }

    // Existing names must not silently reactivate deleted records or move an employee
    // from a different branch. A previously unassigned employee can be recovered on retry.
    if (action.action === 'service') {
      const sameName = await target.pool.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId)
        .input('name', sql.NVarChar(200), action.service.name)
        .query(`SELECT TOP 1 ProID, isDeleted FROM dbo.TblPro WHERE TenantId = @tenantId AND ProName = @name;`);
      if (sameName.recordset.length) {
        if (Number(sameName.recordset[0].isDeleted) === 1) return reply({ error: 'الخدمة موجودة وغير نشطة. راجع إدارة الخدمات.' }, 409);
        return reply({ ok: true, created: 0, existing: 1 });
      }
    } else {
      const sameName = await target.pool.request().input('tenantId', sql.UniqueIdentifier, auth.tenantId)
        .input('name', sql.NVarChar(200), action.employee.name)
        .input('branchId', sql.Int, auth.activeBranchId)
        .query(`
          SELECT TOP 1 e.EmpID, ISNULL(e.isActive, 1) AS Active,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment a
              WHERE a.EmpID = e.EmpID AND a.BranchID = @branchId AND a.IsActive = 1
                AND a.EffectiveFrom <= CAST(GETUTCDATE() AS date)
                AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(GETUTCDATE() AS date))) THEN 1 ELSE 0 END AS HereNow,
            CASE WHEN EXISTS (SELECT 1 FROM dbo.TblEmpBranchAssignment a
              WHERE a.EmpID = e.EmpID AND a.IsActive = 1
                AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= CAST(GETUTCDATE() AS date))) THEN 1 ELSE 0 END AS HasAssignment
          FROM dbo.TblEmp e WHERE e.TenantId = @tenantId AND e.EmpName = @name;
        `);
      const existing = sameName.recordset[0];
      if (existing) {
        if (!Number(existing.Active)) return reply({ error: 'الموظف موجود وغير نشط. راجع إدارة الموظفين.' }, 409);
        if (Number(existing.HereNow)) return reply({ ok: true, created: 0, existing: 1 });
        if (Number(existing.HasAssignment)) return reply({ error: 'الموظف له ربط بفرع أو جدول آخر. راجع الإدارة.' }, 409);
      }
    }

    const ctx: OnboardingSetupContext = {
      tenantId: auth.tenantId, tenantCode: auth.tenant.tenantCode, packCode: 'salon',
      apps: await getTenantInstalledAppsForGate(auth.tenantId),
      ownerUserId: auth.userId, actorUserId: auth.userId,
      branchIds: new Map([[auth.activeBranchCode.toUpperCase(), auth.activeBranchId]]),
    };
    // Reuse tenant-scoped provisioning stages, without core tenant creation or booking publication.
    const outcome = action.action === 'service'
      ? await runServicesStage(ctx, { services: [action.service] })
      : await runTeamStage(ctx, { employees: [{ ...action.employee, primaryBranchCode: auth.activeBranchCode }] });
    return reply({ ok: true, ...outcome });
  } catch (err) {
    if (err instanceof SetupInputError) return reply({ error: err.message }, 400);
    console.error('[tenant/onboarding/setup-data] save failed', err);
    return reply({ error: 'تعذر حفظ البيانات. راجع القائمة قبل إعادة المحاولة.' }, 500);
  }
}
