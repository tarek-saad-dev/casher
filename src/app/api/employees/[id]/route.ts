import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/employees/:id
// Accepts any subset of payroll settings:
// { empName?, isActive?, baseSalary?, salaryType?, targetCommissionPercent?,
//   targetMinSales?, defaultCheckInTime?, defaultCheckOutTime?, isPayrollEnabled? }
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { id } = await params;
    const empID  = parseInt(id);
    if (isNaN(empID)) {
      return NextResponse.json({ error: 'معرف الموظف غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const {
      empName,
      isActive,
      baseSalary,
      salaryType,
      targetCommissionPercent,
      targetMinSales,
      defaultCheckInTime,
      defaultCheckOutTime,
      isPayrollEnabled,
    } = body;

    // Validate numeric fields
    if (baseSalary !== undefined && (isNaN(Number(baseSalary)) || Number(baseSalary) < 0)) {
      return NextResponse.json({ error: 'BaseSalary يجب أن يكون رقمًا موجبًا' }, { status: 400 });
    }
    if (targetCommissionPercent !== undefined) {
      const pct = Number(targetCommissionPercent);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return NextResponse.json({ error: 'TargetCommissionPercent يجب أن يكون بين 0 و 100' }, { status: 400 });
      }
    }
    if (targetMinSales !== undefined && (isNaN(Number(targetMinSales)) || Number(targetMinSales) < 0)) {
      return NextResponse.json({ error: 'TargetMinSales يجب أن يكون رقمًا موجبًا' }, { status: 400 });
    }
    const VALID_SALARY_TYPES = ['monthly', 'daily', 'hourly'];
    if (salaryType !== undefined && !VALID_SALARY_TYPES.includes(String(salaryType))) {
      return NextResponse.json({ error: `SalaryType يجب أن يكون: ${VALID_SALARY_TYPES.join(', ')}` }, { status: 400 });
    }

    const setClauses: string[] = [];
    const request = new sql.Request((await getPool()) as any);

    if (empName                 !== undefined) { setClauses.push('EmpName                 = @empName');                 request.input('empName',                 sql.NVarChar(200),   String(empName).trim()); }
    if (isActive                !== undefined) { setClauses.push('isActive                = @isActive');                request.input('isActive',                sql.Bit,             isActive ? 1 : 0); }
    if (baseSalary              !== undefined) { setClauses.push('BaseSalary              = @baseSalary');              request.input('baseSalary',              sql.Decimal(10, 2),  Number(baseSalary)); }
    if (salaryType              !== undefined) { setClauses.push('SalaryType              = @salaryType');              request.input('salaryType',              sql.NVarChar(20),    String(salaryType)); }
    if (targetCommissionPercent !== undefined) { setClauses.push('TargetCommissionPercent = @targetCommissionPercent'); request.input('targetCommissionPercent', sql.Decimal(5, 2),   Number(targetCommissionPercent)); }
    if (targetMinSales          !== undefined) { setClauses.push('TargetMinSales          = @targetMinSales');          request.input('targetMinSales',          sql.Decimal(10, 2),  Number(targetMinSales)); }
    if (defaultCheckInTime      !== undefined) { setClauses.push('DefaultCheckInTime      = @defaultCheckInTime');      request.input('defaultCheckInTime',      sql.NVarChar(10),    defaultCheckInTime ?? null); }
    if (defaultCheckOutTime     !== undefined) { setClauses.push('DefaultCheckOutTime     = @defaultCheckOutTime');     request.input('defaultCheckOutTime',     sql.NVarChar(10),    defaultCheckOutTime ?? null); }
    if (isPayrollEnabled        !== undefined) { setClauses.push('IsPayrollEnabled        = @isPayrollEnabled');        request.input('isPayrollEnabled',        sql.Bit,             isPayrollEnabled ? 1 : 0); }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'لا توجد بيانات للتعديل' }, { status: 400 });
    }

    request.input('empID', sql.Int, empID);
    const result = await request.query(`
      UPDATE dbo.TblEmp
      SET    ${setClauses.join(', ')}
      OUTPUT
        INSERTED.EmpID,
        INSERTED.EmpName,
        INSERTED.isActive,
        INSERTED.BaseSalary,
        INSERTED.SalaryType,
        INSERTED.TargetCommissionPercent,
        INSERTED.TargetMinSales,
        INSERTED.DefaultCheckInTime,
        INSERTED.DefaultCheckOutTime,
        INSERTED.IsPayrollEnabled
      WHERE  EmpID = @empID
    `);

    if (result.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    return NextResponse.json(result.recordset[0]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees/:id] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
