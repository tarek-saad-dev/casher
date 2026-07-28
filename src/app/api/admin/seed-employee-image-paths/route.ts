/**
 * POST /api/admin/seed-employee-image-paths
 * Ensures TblEmp.ImageUrl exists and seeds default paths for known barbers.
 * Idempotent — only updates rows with empty ImageUrl.
 */
import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { BARBER_IMAGE_BY_EMP_NAME } from '@/lib/barberImages';
import { ensureTblEmpImageUrlColumn } from '@/lib/migrations/ensureEmployeeImageUrl';
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
    const ready = await ensureTblEmpImageUrlColumn(db);
    if (!ready) {
      return NextResponse.json(
        { ok: false, error: 'عمود ImageUrl غير متوفر في TblEmp' },
        { status: 500 },
      );
    }

    let updated = 0;
    let skipped = 0;
    const details: {
      empName: string;
      imageUrl: string;
      status: 'updated' | 'skipped' | 'not_found';
      empIds?: number[];
    }[] = [];

    for (const [empName, imageUrl] of Object.entries(BARBER_IMAGE_BY_EMP_NAME)) {
      const existing = await db
        .request()
        .input('EmpName', sql.NVarChar(100), empName)
        .query(`SELECT EmpID, ImageUrl FROM [dbo].[TblEmp] WHERE EmpName = @EmpName`);

      if (existing.recordset.length === 0) {
        details.push({ empName, imageUrl, status: 'not_found' });
        continue;
      }

      const empIds: number[] = [];
      let anyUpdated = false;
      for (const row of existing.recordset) {
        empIds.push(Number(row.EmpID));
        const current = String(row.ImageUrl ?? '').trim();
        if (current) {
          skipped++;
          continue;
        }
        await db
          .request()
          .input('EmpID', sql.Int, Number(row.EmpID))
          .input('ImageUrl', sql.NVarChar(1000), imageUrl)
          .query(`UPDATE [dbo].[TblEmp] SET ImageUrl = @ImageUrl WHERE EmpID = @EmpID`);
        updated++;
        anyUpdated = true;
      }
      details.push({
        empName,
        imageUrl,
        status: anyUpdated ? 'updated' : 'skipped',
        empIds,
      });
    }

    if (updated > 0) {
      invalidatePublicBookingBarbersCache();
    }

    return NextResponse.json({
      ok: true,
      message: 'Employee image paths seeded',
      updated,
      skipped,
      details,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/admin/seed-employee-image-paths] error:', message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
