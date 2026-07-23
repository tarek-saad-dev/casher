import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
  listBookableEmployeeIdsForBranch,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/barbers?branchCode=XXX&date=YYYY-MM-DD
 * Returns active bookable barbers for the branch — no admin data exposed.
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const branchCode = extractPublicBranchCode(searchParams);
    let branch;
    try {
      branch = await resolvePublicBranchCode(branchCode);
    } catch (err) {
      if (err instanceof BranchDomainError) {
        return err.code === 'BRANCH_REQUIRED'
          ? publicBranchRequiredResponse()
          : publicInvalidBranchResponse();
      }
      throw err;
    }

    const dateParam = searchParams.get('date');
    const operationalDate =
      dateParam && isValidDate(dateParam) ? dateParam : getCairoBusinessDate();

    const bookableIds = await listBookableEmployeeIdsForBranch(branch.branchId, operationalDate);
    if (bookableIds.length === 0) {
      return NextResponse.json({ ok: true, barbers: [] }, { headers: PUBLIC_CORS_HEADERS });
    }

    const db = await getPool();
    const res = await db
      .request()
      .query(`
      SELECT
        e.EmpID   AS id,
        e.EmpName AS name,
        e.Job     AS job
      FROM [dbo].[TblEmp] e
      WHERE ISNULL(e.isActive, 1) = 1
        AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
        AND e.EmpID IN (${bookableIds.join(',')})
      ORDER BY e.EmpName
    `);

    const barbers = res.recordset.map((r: any) => ({
      id:               r.id,
      name:             r.name,
      job:              r.job,
      photoUrl:         null,
      bio:              null,
      isBookableOnline: true,
    }));

    return NextResponse.json({ ok: true, barbers }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/barbers]', err);
    return NextResponse.json({ error: 'فشل تحميل الحلاقين' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
