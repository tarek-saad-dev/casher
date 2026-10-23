import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { resolveLegacyBootstrapTenantId } from '@/platform/tenant/legacyBootstrapSeam';

export const dynamic = 'force-dynamic';

/** History of completed automatic-close attempts, not payroll generation or manual day locks. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const month = request.nextUrl.searchParams.get('month') ?? '';
  const year = Number(month.slice(0, 4));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || year < 1900 || year > 9998) {
    return NextResponse.json({ error: 'الشهر غير صالح' }, { status: 400 });
  }
  try {
    // This global legacy table belongs only to CASHER_BOOT; never default another tenant into it.
    const ownerTenantId = await resolveLegacyBootstrapTenantId('legacy-payroll-job-log');
    if (auth.tenantId.toLowerCase() !== ownerTenantId.toLowerCase()) {
      return NextResponse.json({ available: false, month, lastSuccessfulWorkDate: null, days: [] });
    }
    const db = await getPool();
    const result = await db.request().input('monthStart', sql.Date, `${month}-01`).query(`
      WITH Runs AS (
        SELECT WorkDate, Success, CreatedAt
        FROM dbo.TblAutoGenLog
        CROSS APPLY (SELECT CASE WHEN ISJSON(MissingJson) = 1 THEN MissingJson ELSE N'{}' END AS Payload) p
        WHERE JSON_VALUE(p.Payload, '$.dryRun') = N'false'
          AND JSON_QUERY(p.Payload, '$.steps') IS NOT NULL
      ), Ranked AS (
        SELECT WorkDate, Success,
          ROW_NUMBER() OVER (PARTITION BY WorkDate ORDER BY CreatedAt DESC, Success ASC) AS rn,
          MAX(CASE WHEN Success = 1 THEN WorkDate END) OVER () AS LastSuccessfulWorkDate
        FROM Runs
      )
      SELECT CONVERT(char(10), WorkDate, 23) AS WorkDate, Success,
        CONVERT(char(10), LastSuccessfulWorkDate, 23) AS LastSuccessfulWorkDate
      FROM Ranked
      WHERE rn = 1 AND (
        (WorkDate >= @monthStart AND WorkDate < DATEADD(month, 1, @monthStart))
        OR WorkDate = LastSuccessfulWorkDate
      )
      ORDER BY WorkDate
    `);
    const rows = result.recordset as Array<{ WorkDate: string; Success: boolean; LastSuccessfulWorkDate: string | null }>;
    return NextResponse.json({
      available: true,
      month,
      lastSuccessfulWorkDate: rows[0]?.LastSuccessfulWorkDate ?? null,
      days: rows.filter(row => row.WorkDate.startsWith(`${month}-`)).map(row => ({ date: row.WorkDate, success: Boolean(row.Success) })),
    });
  } catch {
    return NextResponse.json({ error: 'تعذر تحميل سجل قفل اليوم' }, { status: 500 });
  }
}
