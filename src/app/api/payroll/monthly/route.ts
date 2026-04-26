import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/payroll/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to   = searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json(
        { error: 'يجب تحديد from و to بصيغة YYYY-MM-DD' },
        { status: 400 }
      );
    }
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: 'صيغة التاريخ غير صحيحة، استخدم YYYY-MM-DD' }, { status: 400 });
    }
    if (from > to) {
      return NextResponse.json({ error: 'from يجب أن يكون قبل to' }, { status: 400 });
    }

    const db = await getPool();
    const result = await db.request()
      .input('FromDate', sql.Date, from)
      .input('ToDate',   sql.Date, to)
      .execute('dbo.sp_GetMonthlyPayroll');

    const data = result.recordset as Array<{
      BaseSalary: number;
      MonthlyWorkTotal: number;
      TargetCommissionAmount: number;
      TotalEmployeeDeductions: number;
      NetSalary: number;
    }>;

    const summary = {
      employeesCount:    data.length,
      totalBaseSalary:   data.reduce((s, r) => s + (r.BaseSalary              ?? 0), 0),
      totalMonthlyWork:  data.reduce((s, r) => s + (r.MonthlyWorkTotal         ?? 0), 0),
      totalCommission:   data.reduce((s, r) => s + (r.TargetCommissionAmount   ?? 0), 0),
      totalDeductions:   data.reduce((s, r) => s + (r.TotalEmployeeDeductions  ?? 0), 0),
      totalNetSalary:    data.reduce((s, r) => s + (r.NetSalary                ?? 0), 0),
    };

    return NextResponse.json({ success: true, from, to, data, summary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payroll/monthly] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
