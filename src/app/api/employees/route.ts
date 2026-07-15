import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  usesHrModelPayload,
  validateEmployeeHrPayload,
  mapNormalizedToDbColumns,
  enrichEmployeeRow,
  normalizeEmploymentType,
  normalizePayrollMethod,
  isFreelanceMonthlyBlocked,
  type EmployeeHrPayload,
  type NormalizedHrFields,
} from '@/lib/hr/employee-hr-model';
import { buildScheduleRows } from '@/lib/hr/employee-hr-schedule';
import {
  EMPLOYEE_LIST_SELECT,
  buildHrInsertQuery,
  ensureScheduleTable,
  upsertEmployeeSchedule,
} from '@/lib/hr/employee-hr-db';
import { ensureEmployeeAdvanceMapping } from '@/lib/hr/employee-hr-advance';
import { getEmployeesTargetSummaryBatch } from '@/lib/payroll/employee-target';

// GET /api/employees — list employees with finance mapping
// Query params: ?inactive=true to get inactive employees
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const showInactive = searchParams.get('inactive') === 'true';

    const db = await getPool();
    const result = await db.request().query(`
      ${EMPLOYEE_LIST_SELECT}
      WHERE ISNULL(e.isActive, 1) = ${showInactive ? '0' : '1'}
      ORDER BY e.EmpName
    `);

    let targetSummary = new Map<
      number,
      {
        hasTargetPlan: boolean;
        targetEnabled: boolean | null;
        targetTierCount: number | null;
        targetFirstDailyStart: number | null;
        targetFirstRatePercent: number | null;
        targetEffectiveFrom: string | null;
      }
    >();
    try {
      targetSummary = await getEmployeesTargetSummaryBatch(getCairoBusinessDate());
    } catch (summaryErr: unknown) {
      console.warn(
        '[api/employees] target summary skipped:',
        summaryErr instanceof Error ? summaryErr.message : summaryErr,
      );
    }

    const rows = result.recordset.map((row: Record<string, unknown>) => {
      const enriched = enrichEmployeeRow(row);
      const empId = Number(enriched.EmpID);
      const summary = targetSummary.get(empId);
      return {
        ...enriched,
        hasTargetPlan: summary?.hasTargetPlan ?? false,
        targetEnabled: summary?.targetEnabled ?? null,
        targetTierCount: summary?.targetTierCount ?? null,
        targetFirstDailyStart: summary?.targetFirstDailyStart ?? null,
        targetFirstRatePercent: summary?.targetFirstRatePercent ?? null,
        targetEffectiveFrom: summary?.targetEffectiveFrom ?? null,
      };
    });
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/employees
// Legacy: { empName, isActive? }
// HR model: optional full payload with employmentType, payrollMethod, scheduleConfig, etc.
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = (await req.json()) as EmployeeHrPayload;
    const isHrPayload = usesHrModelPayload(body);

    const validation = validateEmployeeHrPayload(body, {
      mode: 'create',
      isHrPayload,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
    }

    const name = String(body.empName).trim();
    const isActive = body.isActive !== false;

    const db = await getPool();
    const transaction = new sql.Transaction(db);
    await transaction.begin();

    try {
      let newEmp: { EmpID: number; EmpName: string; isActive: boolean };

      if (isHrPayload && validation.normalized) {
        const dbCols = mapNormalizedToDbColumns(validation.normalized);
        const { sql: insertSql, bind } = buildHrInsertQuery(name, isActive, dbCols);
        const insertReq = new sql.Request(transaction);
        bind(insertReq);
        const empRes = await insertReq.query(insertSql);
        newEmp = empRes.recordset[0];

        if (validation.normalized.scheduleConfig) {
          await ensureScheduleTable(db);
          const scheduleRows = buildScheduleRows(
            validation.normalized.employmentType,
            validation.normalized.dayOffPolicy,
            validation.normalized.scheduleConfig,
            validation.normalized.defaultStartTime,
            validation.normalized.defaultEndTime,
          );
          await upsertEmployeeSchedule(transaction, newEmp.EmpID, scheduleRows);
        }
      } else {
        const empRes = await new sql.Request(transaction)
          .input('empName', sql.NVarChar(200), name)
          .input('isActive', sql.Bit, isActive ? 1 : 0)
          .query(`
            INSERT INTO dbo.TblEmp (EmpName, isActive)
            VALUES (@empName, @isActive);

            SELECT EmpID, EmpName, isActive
            FROM dbo.TblEmp
            WHERE EmpID = SCOPE_IDENTITY();
          `);
        newEmp = empRes.recordset[0];
      }

      const newEmpID = newEmp.EmpID;
      console.log(`[api/employees] Inserted EmpID=${newEmpID}  EmpName=${name}`);

      const { expINID, catName } = await ensureEmployeeAdvanceMapping(
        transaction,
        newEmpID,
        name,
      );

      await transaction.commit();

      return NextResponse.json(
        {
          EmpID: newEmpID,
          EmpName: newEmp.EmpName,
          isActive: newEmp.isActive,
          AdvanceExpINID: expINID,
          AdvanceCatName: catName,
          ...(isHrPayload && validation.normalized
            ? {
                EmploymentType: validation.normalized.employmentType,
                PayrollMethod: validation.normalized.payrollMethod,
                DayOffPolicy: validation.normalized.dayOffPolicy,
              }
            : {}),
        },
        { status: 201 },
      );
    } catch (innerErr) {
      await transaction.rollback();
      throw innerErr;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export { type EmployeeHrPayload, type NormalizedHrFields };
