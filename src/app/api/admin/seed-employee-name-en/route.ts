/**
 * POST /api/admin/seed-employee-name-en
 * Seeds default English names for known barbers (only when EmpNameEn empty).
 */
import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { BARBER_NAME_EN_BY_EMP_NAME } from '@/lib/barberImages';
import { ensureTblEmpNameEnColumn } from '@/lib/migrations/ensureEmployeeNameEn';
import { invalidatePublicBookingBarbersCache } from '@/lib/booking/publicBookingBarbers';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const session = await getSession();
    if (!session || session.UserLevel !== 'admin') {
      return NextResponse.json(
        { ok: false, error: 'غير مصرح - يتطلب صلاحيات المدير' },
        { status: 403 },
      );
    }

    const db = await getPool();
    const ready = await ensureTblEmpNameEnColumn(db);
    if (!ready) {
      return NextResponse.json(
        { ok: false, error: 'عمود EmpNameEn غير متوفر' },
        { status: 500 },
      );
    }

    let updated = 0;
    let skipped = 0;
    const details: Array<{
      empName: string;
      nameEn: string;
      status: 'updated' | 'skipped' | 'not_found';
      empIds?: number[];
    }> = [];

    for (const [empName, nameEn] of Object.entries(BARBER_NAME_EN_BY_EMP_NAME)) {
      const existing = await db
        .request()
        .input('EmpName', sql.NVarChar(100), empName)
        .query(`SELECT EmpID, EmpNameEn FROM dbo.TblEmp WHERE EmpName = @EmpName`);

      if (!existing.recordset.length) {
        details.push({ empName, nameEn, status: 'not_found' });
        continue;
      }

      const empIds: number[] = [];
      let anyUpdated = false;
      for (const row of existing.recordset) {
        empIds.push(Number(row.EmpID));
        const current = String(row.EmpNameEn ?? '').trim();
        if (current) {
          skipped++;
          continue;
        }
        await db
          .request()
          .input('EmpID', sql.Int, Number(row.EmpID))
          .input('EmpNameEn', sql.NVarChar(200), nameEn)
          .query(`UPDATE dbo.TblEmp SET EmpNameEn = @EmpNameEn WHERE EmpID = @EmpID`);
        updated++;
        anyUpdated = true;
      }
      details.push({
        empName,
        nameEn,
        status: anyUpdated ? 'updated' : 'skipped',
        empIds,
      });
    }

    if (updated > 0) invalidatePublicBookingBarbersCache();

    return NextResponse.json({
      ok: true,
      message: 'Employee English names seeded',
      updated,
      skipped,
      details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/seed-employee-name-en]', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
