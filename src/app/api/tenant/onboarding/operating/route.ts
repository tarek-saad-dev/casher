import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { assertLegacyBranchInTenant } from '@/platform/tenant/tenantContext';
import { getTenantInstalledAppsForGate } from '@/platform/commercial/tenantAccessGate';
import { isPublicSalonSetupTenant } from '@/platform/onboarding/selfServiceEligibility';
import { parseOperatingBookingPreferences } from '@/platform/onboarding/operatingPreferences';
import { invalidatePublicSettingsCache } from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (body: object, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function context() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return { response: auth } as const;
  if (!(await isPublicSalonSetupTenant(auth.tenantId, auth.tenant.tenantCode))) return { response: reply({error:'التجهيز غير متاح.'},403) } as const;
  await assertLegacyBranchInTenant(auth.tenantId,auth.activeBranchId);
  const apps = await getTenantInstalledAppsForGate(auth.tenantId);
  const branch = await getBranchById(auth.activeBranchId);
  if (!branch) return { response: reply({error:'الفرع غير متاح.'},404) } as const;
  return { auth, apps, branch } as const;
}
export async function GET() {
  try {
    const c = await context();
    if ('response' in c) return c.response;
    const { auth, apps, branch } = c;
    let booking = null;
    if (apps.includes('booking')) {
      const pool = await getPool();
      const result = await pool.request().input('branchId',sql.Int,auth.activeBranchId)
        .query('SELECT TOP 1 SlotIntervalMinutes, MinNoticeMinutes, MaxBookingDaysAhead, BookingEnabled FROM dbo.QueueBookingSettings WHERE BranchID = @branchId ORDER BY SettingID DESC;');
      const row = result.recordset[0];
      if (row) booking = { slotIntervalMinutes:Number(row.SlotIntervalMinutes), minNoticeMinutes:Number(row.MinNoticeMinutes), maxBookingDaysAhead:Number(row.MaxBookingDaysAhead), enabled:row.BookingEnabled === true || Number(row.BookingEnabled) === 1 };
    }
    return reply({ok:true,branchName:branch.branchName,apps,booking,publicBookingEnabled:Boolean(branch.publicBookingEnabled)});
  } catch { return reply({error:'تعذر تحميل إعدادات التشغيل.'},503); }
}
export async function PATCH(req: Request) {
  if (req.headers.get('sec-fetch-site') === 'cross-site' || !req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return reply({error:'طلب غير صالح.'},415);
  try {
    const c = await context();
    if ('response' in c) return c.response;
    if (!c.apps.includes('booking')) return reply({error:'تطبيق الحجوزات غير مثبت.'},403);
    let preferences;
    try { preferences = parseOperatingBookingPreferences(await req.json()); }
    catch (error) { return reply({error:error instanceof Error?error.message:'راجع البيانات.'},400); }
    const pool = await getPool();
    const result = await pool.request()
      .input('branchId',sql.Int,c.auth.activeBranchId)
      .input('tenantId',sql.UniqueIdentifier,c.auth.tenantId)
      .input('slot',sql.Int,preferences.slotIntervalMinutes)
      .input('notice',sql.Int,preferences.minNoticeMinutes)
      .input('horizon',sql.Int,preferences.maxBookingDaysAhead)
      .query(`
        UPDATE q SET SlotIntervalMinutes=@slot, MinNoticeMinutes=@notice, MaxBookingDaysAhead=@horizon, UpdatedAt=GETDATE()
        FROM dbo.QueueBookingSettings q
        WHERE q.BranchID=@branchId AND EXISTS (
          SELECT 1 FROM dbo.Location l WHERE l.LegacyBranchId=q.BranchID AND l.TenantId=@tenantId
        );
      `);
    if (!result.rowsAffected.some(n=>n>0)) return reply({error:'إعدادات الحجز غير مهيأة. افتح إعدادات الحجوزات أولًا.'},409);
    invalidatePublicSettingsCache(c.auth.activeBranchId);
    return reply({ok:true,preferences});
  } catch { return reply({error:'تعذر حفظ إعدادات الحجز.'},503); }
}
