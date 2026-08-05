import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  validateEmployeeHrPayload,
  mapNormalizedToDbColumns,
  enrichEmployeeRow,
  normalizeEmploymentType,
  normalizePayrollMethod,
  normalizeDayOffPolicy,
  isFreelanceMonthlyBlocked,
  usesHrModelPayload,
  type EmployeeHrPayload,
} from '@/lib/hr/employee-hr-model';
import { buildScheduleRows } from '@/lib/hr/employee-hr-schedule';
import {
  EMPLOYEE_SELECT_BY_ID,
  ensureScheduleTable,
  upsertEmployeeSchedule,
} from '@/lib/hr/employee-hr-db';
import { ensureTblEmpImageUrlColumn } from '@/lib/migrations/ensureEmployeeImageUrl';
import { ensureTblEmpNameEnColumn, normalizeEmpNameEn } from '@/lib/migrations/ensureEmployeeNameEn';
import { invalidatePublicBookingBarbersCache } from '@/lib/booking/publicBookingBarbers';
import { normalizeEmployeeImageUrlInput } from '@/lib/hr/employeeImageUrl';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  loadPrimaryBranchPayrollRatesForEmployee,
  overlayEmployeeRowWithBranchPlanRates,
  syncHrRatesToActiveBranchPlans,
  type BranchPayrollPayType,
} from '@/lib/payroll/branchPayrollPlan';

type Ctx = { params: Promise<{ id: string }> };

function parsePatchHrPayload(body: EmployeeHrPayload): EmployeeHrPayload {
  const patchPayload: EmployeeHrPayload = { ...body };

  if (body.defaultStartTime !== undefined || body.defaultCheckInTime !== undefined) {
    patchPayload.defaultStartTime =
      body.defaultStartTime ?? body.defaultCheckInTime ?? null;
  }
  if (body.defaultEndTime !== undefined || body.defaultCheckOutTime !== undefined) {
    patchPayload.defaultEndTime =
      body.defaultEndTime ?? body.defaultCheckOutTime ?? null;
  }

  return patchPayload;
}

function patchTouchesHrModel(body: EmployeeHrPayload): boolean {
  return (
    usesHrModelPayload(body) ||
    body.employmentType !== undefined ||
    body.payrollMethod !== undefined ||
    body.manualHourlyRate !== undefined ||
    body.hourlyRate !== undefined ||
    body.dailyRate !== undefined ||
    body.monthlySalary !== undefined ||
    body.hireDate !== undefined ||
    body.dayOffPolicy !== undefined ||
    body.isAttendanceExempt !== undefined
  );
}

// PATCH /api/employees/:id
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { id } = await params;
    const empID = parseInt(id);
    if (isNaN(empID)) {
      return NextResponse.json({ error: 'معرف الموظف غير صالح' }, { status: 400 });
    }

    const body = (await req.json()) as EmployeeHrPayload & {
      imageUrl?: string | null;
      empNameEn?: string | null;
    };
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
      whatsApp,
      imageUrl,
      empNameEn,
    } = body;

    const pool = await getPool();

    const currentRes = await pool.request().input('empID', sql.Int, empID).query(`
      SELECT
        EmploymentType, PayrollMethod, DayOffPolicy, IsPayrollEnabled,
        ManualHourlyRate, DailyRate, BaseSalary
      FROM dbo.TblEmp WHERE EmpID = @empID
    `);

    if (currentRes.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const current = currentRes.recordset[0];
    const patchPayload = parsePatchHrPayload(body);
    const hasHrFields = patchTouchesHrModel(body);
    const planRates = await loadPrimaryBranchPayrollRatesForEmployee(empID);

    if (body.employmentType !== undefined || body.payrollMethod !== undefined) {
      const et =
        normalizeEmploymentType(body.employmentType) ??
        normalizeEmploymentType(current.EmploymentType);
      const pm =
        normalizePayrollMethod(body.payrollMethod) ??
        normalizePayrollMethod(current.PayrollMethod);
      if (isFreelanceMonthlyBlocked(et, pm)) {
        return NextResponse.json(
          { error: 'الفري لانس يتم حسابه بالساعة أو اليومية فقط' },
          { status: 400 },
        );
      }
    }

    const setClauses: string[] = [];
    const bindInputs: Array<(req: sql.Request) => void> = [];

    const addClause = (clause: string, bind?: (req: sql.Request) => void) => {
      setClauses.push(clause);
      if (bind) bindInputs.push(bind);
    };

    if (empName !== undefined) {
      addClause('EmpName = @empName', (req) =>
        req.input('empName', sql.NVarChar(200), String(empName).trim()),
      );
    }
    if (isActive !== undefined) {
      addClause('isActive = @isActive', (req) =>
        req.input('isActive', sql.Bit, isActive ? 1 : 0),
      );
    }
    if (baseSalary !== undefined && !(hasHrFields && body.monthlySalary !== undefined)) {
      if (isNaN(Number(baseSalary)) || Number(baseSalary) < 0) {
        return NextResponse.json({ error: 'BaseSalary يجب أن يكون رقمًا موجبًا' }, { status: 400 });
      }
      addClause('BaseSalary = @baseSalary', (req) =>
        req.input('baseSalary', sql.Decimal(10, 2), Number(baseSalary)),
      );
    }
    if (salaryType !== undefined) {
      const VALID_SALARY_TYPES = ['monthly', 'daily', 'hourly'];
      if (!VALID_SALARY_TYPES.includes(String(salaryType))) {
        return NextResponse.json(
          { error: `SalaryType يجب أن يكون: ${VALID_SALARY_TYPES.join(', ')}` },
          { status: 400 },
        );
      }
      addClause('SalaryType = @salaryType', (req) =>
        req.input('salaryType', sql.NVarChar(20), String(salaryType)),
      );
    }
    if (targetCommissionPercent !== undefined) {
      const pct = Number(targetCommissionPercent);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return NextResponse.json(
          { error: 'TargetCommissionPercent يجب أن يكون بين 0 و 100' },
          { status: 400 },
        );
      }
      addClause('TargetCommissionPercent = @targetCommissionPercent', (req) =>
        req.input('targetCommissionPercent', sql.Decimal(5, 2), pct),
      );
    }
    if (targetMinSales !== undefined) {
      if (isNaN(Number(targetMinSales)) || Number(targetMinSales) < 0) {
        return NextResponse.json({ error: 'TargetMinSales يجب أن يكون رقمًا موجبًا' }, { status: 400 });
      }
      addClause('TargetMinSales = @targetMinSales', (req) =>
        req.input('targetMinSales', sql.Decimal(10, 2), Number(targetMinSales)),
      );
    }
    if (
      defaultCheckInTime !== undefined &&
      !hasHrFields &&
      body.defaultStartTime === undefined
    ) {
      addClause('DefaultCheckInTime = @defaultCheckInTime', (req) =>
        req.input('defaultCheckInTime', sql.NVarChar(10), defaultCheckInTime ?? null),
      );
    }
    if (
      defaultCheckOutTime !== undefined &&
      !hasHrFields &&
      body.defaultEndTime === undefined
    ) {
      addClause('DefaultCheckOutTime = @defaultCheckOutTime', (req) =>
        req.input('defaultCheckOutTime', sql.NVarChar(10), defaultCheckOutTime ?? null),
      );
    }
    if (isPayrollEnabled !== undefined && !hasHrFields) {
      addClause('IsPayrollEnabled = @isPayrollEnabled', (req) =>
        req.input('isPayrollEnabled', sql.Bit, isPayrollEnabled ? 1 : 0),
      );
    }
    if (whatsApp !== undefined) {
      addClause('WhatsApp = @whatsApp', (req) =>
        req.input('whatsApp', sql.NVarChar(30), whatsApp ? String(whatsApp).trim() : null),
      );
    }
    if (imageUrl !== undefined) {
      const normalized = normalizeEmployeeImageUrlInput(imageUrl);
      if (!normalized.ok) {
        return NextResponse.json({ error: normalized.error }, { status: 400 });
      }
      const hasCol = await ensureTblEmpImageUrlColumn(pool);
      if (!hasCol) {
        return NextResponse.json(
          { error: 'عمود ImageUrl غير متوفر — شغّل /api/admin/migrate-employee-image-url' },
          { status: 500 },
        );
      }
      addClause('ImageUrl = @imageUrl', (req) =>
        req.input('imageUrl', sql.NVarChar(1000), normalized.value),
      );
    }
    if (empNameEn !== undefined) {
      const hasCol = await ensureTblEmpNameEnColumn(pool);
      if (!hasCol) {
        return NextResponse.json(
          { error: 'عمود EmpNameEn غير متوفر — شغّل /api/admin/migrate-employee-name-en' },
          { status: 500 },
        );
      }
      addClause('EmpNameEn = @empNameEn', (req) =>
        req.input('empNameEn', sql.NVarChar(200), normalizeEmpNameEn(empNameEn)),
      );
    }

    let scheduleToApply: ReturnType<typeof buildScheduleRows> | null = null;
    let pendingRateSync: {
      payType: BranchPayrollPayType;
      hourlyRate: number | null;
      dailyRate: number | null;
      monthlySalary: number | null;
    } | null = null;

    if (hasHrFields) {
      const validation = validateEmployeeHrPayload(patchPayload, {
        mode: 'patch',
        isHrPayload: true,
        currentEmploymentType: normalizeEmploymentType(current.EmploymentType),
        currentPayrollMethod: normalizePayrollMethod(current.PayrollMethod),
        currentDayOffPolicy: normalizeDayOffPolicy(current.DayOffPolicy),
        currentIsPayrollEnabled: Boolean(current.IsPayrollEnabled),
        currentManualHourlyRate: planRates.hourlyRate,
        currentDailyRate: planRates.dailyRate,
        currentBaseSalary: planRates.monthlySalary,
      });

      if (!validation.ok) {
        return NextResponse.json({ error: validation.errors[0] }, { status: 400 });
      }

      if (validation.normalized) {
        const dbCols = mapNormalizedToDbColumns(validation.normalized);
        const n = validation.normalized;

        if (body.employmentType !== undefined) {
          addClause('EmploymentType = @employmentType', (req) =>
            req.input('employmentType', sql.NVarChar(20), dbCols.EmploymentType),
          );
        }
        if (body.payrollMethod !== undefined) {
          addClause('PayrollMethod = @payrollMethod', (req) =>
            req.input('payrollMethod', sql.NVarChar(20), dbCols.PayrollMethod),
          );
        }
        if (body.dayOffPolicy !== undefined || body.employmentType !== undefined) {
          addClause('DayOffPolicy = @dayOffPolicy', (req) =>
            req.input('dayOffPolicy', sql.NVarChar(20), dbCols.DayOffPolicy),
          );
        }
        if (
          body.employmentType !== undefined ||
          body.isAttendanceExempt !== undefined
        ) {
          addClause('IsAttendanceExempt = @isAttendanceExempt', (req) =>
            req.input('isAttendanceExempt', sql.Bit, dbCols.IsAttendanceExempt),
          );
        }
        if (body.isPayrollEnabled !== undefined) {
          addClause('IsPayrollEnabled = @hrIsPayrollEnabled', (req) =>
            req.input('hrIsPayrollEnabled', sql.Bit, dbCols.IsPayrollEnabled),
          );
        }
        if (
          patchPayload.defaultStartTime !== undefined ||
          body.defaultCheckInTime !== undefined
        ) {
          addClause(
            'DefaultCheckInTime = CASE WHEN @hrCheckIn IS NULL THEN NULL ELSE CONVERT(time, @hrCheckIn) END',
            (req) => req.input('hrCheckIn', sql.VarChar(8), dbCols.DefaultCheckInTime),
          );
        }
        if (
          patchPayload.defaultEndTime !== undefined ||
          body.defaultCheckOutTime !== undefined
        ) {
          addClause(
            'DefaultCheckOutTime = CASE WHEN @hrCheckOut IS NULL THEN NULL ELSE CONVERT(time, @hrCheckOut) END',
            (req) => req.input('hrCheckOut', sql.VarChar(8), dbCols.DefaultCheckOutTime),
          );
        }
        if (body.hireDate !== undefined) {
          addClause('HireDate = @hireDate', (req) =>
            req.input('hireDate', sql.Date, dbCols.HireDate),
          );
        }
        // Rates live only on TblEmpBranchPayrollPlan — do not mirror to TblEmp.
        if (body.payrollMethod !== undefined) {
          addClause('SalaryType = @hrSalaryType', (req) =>
            req.input('hrSalaryType', sql.NVarChar(20), dbCols.SalaryType),
          );
        }

        const rateFieldsTouched =
          body.manualHourlyRate !== undefined ||
          body.hourlyRate !== undefined ||
          body.dailyRate !== undefined ||
          body.monthlySalary !== undefined ||
          body.payrollMethod !== undefined;
        if (rateFieldsTouched) {
          const payTypeRaw = (n.payrollMethod ?? 'hourly') as BranchPayrollPayType;
          pendingRateSync = {
            payType:
              payTypeRaw === 'daily' || payTypeRaw === 'monthly' ? payTypeRaw : 'hourly',
            hourlyRate: n.manualHourlyRate,
            dailyRate: n.dailyRate,
            monthlySalary: n.monthlySalary,
          };
        }

        if (n.scheduleConfig) {
          scheduleToApply = buildScheduleRows(
            n.employmentType,
            n.dayOffPolicy,
            n.scheduleConfig,
            n.defaultStartTime,
            n.defaultEndTime,
          );
        }
      }
    }

    if (setClauses.length === 0 && !pendingRateSync) {
      return NextResponse.json({ error: 'لا توجد بيانات للتعديل' }, { status: 400 });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      if (setClauses.length > 0) {
        const updateReq = new sql.Request(transaction);
        for (const bind of bindInputs) bind(updateReq);
        updateReq.input('empID', sql.Int, empID);
        await updateReq.query(`
          UPDATE dbo.TblEmp
          SET ${setClauses.join(', ')}
          WHERE EmpID = @empID
        `);
      }

      if (scheduleToApply) {
        await ensureScheduleTable(pool);
        await upsertEmployeeSchedule(transaction, empID, scheduleToApply);
      }

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    if (pendingRateSync) {
      await syncHrRatesToActiveBranchPlans({
        empId: empID,
        payType: pendingRateSync.payType,
        hourlyRate: pendingRateSync.hourlyRate,
        dailyRate: pendingRateSync.dailyRate,
        monthlySalary: pendingRateSync.monthlySalary,
        effectiveFrom: getCairoBusinessDate(),
        sourceNotes: 'hr_employee_patch_sole_source',
      });
    }

    const sel = await pool.request().input('empID', sql.Int, empID).query(EMPLOYEE_SELECT_BY_ID);

    if (sel.recordset.length === 0) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    if (imageUrl !== undefined || empNameEn !== undefined) {
      invalidatePublicBookingBarbersCache();
    }

    const freshRates = await loadPrimaryBranchPayrollRatesForEmployee(empID);
    return NextResponse.json(
      enrichEmployeeRow(
        overlayEmployeeRowWithBranchPlanRates(
          sel.recordset[0] as Record<string, unknown>,
          freshRates,
        ),
      ),
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/employees/:id] PATCH error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
