import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { requirePageAccess, isAuthResult } from '@/lib/api-auth';
import { requireMasterDataTenantId } from '@/platform/masterData/tenantScope';
import { getCairoBusinessDate } from '@/lib/businessDate';

type Context = { params: Promise<{ id: string }> };
type PayrollScope = 'global' | 'branch_monthly';
type BranchInput = { branchId: number; enabled: boolean; monthlySalary: number };

function nextMonthStart(): string {
  const [year, month] = getCairoBusinessDate().split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isMonthStart(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-(0[1-9]|1[0-2])-01$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

async function authorize(params: Context['params']) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return { response: auth };
  const { id } = await params;
  const empId = Number(id);
  if (!Number.isSafeInteger(empId) || empId <= 0) return { response: error('معرف الموظف غير صالح') };
  return {
    empId,
    tenantId: requireMasterDataTenantId(auth.tenantId, 'employee branch compensation'),
    userId: auth.userId,
  };
}

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const access = await authorize(params);
    if ('response' in access) return access.response;
    const { empId, tenantId } = access;
    const db = await getPool();
    const employee = await db.request()
      .input('empId', sql.Int, empId)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT EmpID, EmpName, PayrollMethod, EmploymentType,
               ISNULL(IsPayrollEnabled, 1) AS IsPayrollEnabled,
               ISNULL(PayrollScope, N'global') AS PayrollScope,
               PayrollScopeEffectiveFrom
        FROM dbo.TblEmp WHERE EmpID = @empId AND TenantId = @tenantId
      `);
    if (!employee.recordset.length) return error('الموظف غير موجود', 404);
    const effectiveFrom = nextMonthStart();
    const branches = await db.request()
      .input('empId', sql.Int, empId)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .input('effectiveFrom', sql.Date, effectiveFrom)
      .query(`
        SELECT b.BranchID AS branchId, b.BranchCode AS branchCode, b.BranchName AS branchName,
          CASE WHEN EXISTS (
            SELECT 1 FROM dbo.TblEmpBranchAssignment a
            WHERE a.EmpID = @empId AND a.BranchID = b.BranchID
              AND a.IsActive = 1
              AND a.EffectiveFrom <= @effectiveFrom
              AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @effectiveFrom)
          ) THEN 1 ELSE 0 END AS isAssigned,
          p.PayType AS payType, p.MonthlySalary AS monthlySalary,
          p.EffectiveFrom AS planEffectiveFrom
        FROM dbo.TblBranch b
        OUTER APPLY (
          SELECT TOP 1 PayType, MonthlySalary, EffectiveFrom
          FROM dbo.TblEmpBranchPayrollPlan p
          WHERE p.EmpID = @empId AND p.BranchID = b.BranchID AND p.IsActive = 1
            AND p.EffectiveFrom <= @effectiveFrom
            AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= @effectiveFrom)
          ORDER BY p.EffectiveFrom DESC, p.PlanID DESC
        ) p
        WHERE b.IsActive = 1
          AND EXISTS (SELECT 1 FROM dbo.Location l
            WHERE l.LegacyBranchId = b.BranchID AND l.TenantId = @tenantId)
        ORDER BY b.BranchName
      `);
    const e = employee.recordset[0];
    return NextResponse.json({
      employee: {
        empId: Number(e.EmpID),
        empName: String(e.EmpName),
        payrollMethod: e.PayrollMethod,
        employmentType: e.EmploymentType,
        payrollEnabled: Boolean(e.IsPayrollEnabled),
        scope: String(e.PayrollScope) as PayrollScope,
        scopeEffectiveFrom: e.PayrollScopeEffectiveFrom,
      },
      effectiveFrom,
      branches: branches.recordset.map((b: Record<string, unknown>) => ({
        branchId: Number(b.branchId),
        branchCode: String(b.branchCode),
        branchName: String(b.branchName),
        isAssigned: Boolean(b.isAssigned),
        enabled: b.payType === 'monthly' && Number(b.monthlySalary) > 0,
        monthlySalary: b.payType === 'monthly' && b.monthlySalary != null
          ? Number(b.monthlySalary) : null,
        planEffectiveFrom: b.planEffectiveFrom,
      })),
    });
  } catch (err) {
    console.error('[branch-compensation GET]', err);
    return error('تعذر تحميل مرتبات الفروع. تأكد من تطبيق migration الخاص بالميزة', 500);
  }
}

/**
 * All changes are effective on a future month boundary, never retroactively.
 * We version branch plans; historical payroll and ledger rows remain untouched.
 */
export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const access = await authorize(params);
    if ('response' in access) return access.response;
    const { empId, tenantId, userId } = access;
    const body = await request.json() as {
      mode?: PayrollScope;
      effectiveFrom?: string;
      branches?: BranchInput[];
      globalMonthlySalary?: number;
    };
    if (body.mode !== 'global' && body.mode !== 'branch_monthly') return error('اختر نظام المرتب');
    if (!isMonthStart(body.effectiveFrom) || body.effectiveFrom < nextMonthStart()) {
      return error('تاريخ بدء المرتب لازم يكون أول يوم في شهر قادم');
    }
    const requested = Array.isArray(body.branches) ? body.branches : [];
    if (requested.some((b) => !Number.isSafeInteger(b.branchId) || b.branchId <= 0 ||
      typeof b.enabled !== 'boolean' || (b.enabled && !(Number.isFinite(b.monthlySalary) && b.monthlySalary > 0 && b.monthlySalary <= 100000000)))) {
      return error('قيمة مرتب أحد الفروع غير صالحة');
    }
    if (new Set(requested.map((b) => b.branchId)).size !== requested.length) {
      return error('نفس الفرع مكرر في اتفاقيات المرتب');
    }

    const db = await getPool();
    const tx = new sql.Transaction(db);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const empResult = await new sql.Request(tx)
        .input('empId', sql.Int, empId)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`
          SELECT EmpID, EmploymentType, PayrollMethod, IsPayrollEnabled,
                 PayrollScope, PayrollScopeEffectiveFrom
          FROM dbo.TblEmp WITH (UPDLOCK, HOLDLOCK)
          WHERE EmpID = @empId AND TenantId = @tenantId
        `);
      if (!empResult.recordset.length) throw new Error('الموظف غير موجود');
      const employee = empResult.recordset[0];

      if (body.mode === 'branch_monthly' &&
          (employee.EmploymentType === 'freelance' || !Boolean(employee.IsPayrollEnabled) ||
            employee.PayrollMethod !== 'monthly')) {
        throw new Error('الخاصية متاحة للموظف غير الفري لانس بنظام الراتب الشهري المفعّل فقط');
      }

      const available = await new sql.Request(tx)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .query(`
          SELECT b.BranchID
          FROM dbo.TblBranch b
          WHERE b.IsActive = 1 AND EXISTS (
            SELECT 1 FROM dbo.Location l WHERE l.LegacyBranchId = b.BranchID AND l.TenantId = @tenantId
          )
        `);
      const validIds = new Set(available.recordset.map((b: { BranchID: number }) => Number(b.BranchID)));
      if (requested.some((b) => !validIds.has(b.branchId))) throw new Error('أحد الفروع غير تابع للنشاط');

      let enabled = requested.filter((b) => b.enabled);
      if (body.mode === 'branch_monthly') {
        if (!enabled.length) throw new Error('فعّل راتب فرع واحد على الأقل');
        const assignments = await new sql.Request(tx)
          .input('empId', sql.Int, empId)
          .input('from', sql.Date, body.effectiveFrom)
          .query(`
            SELECT DISTINCT BranchID FROM dbo.TblEmpBranchAssignment
            WHERE EmpID = @empId AND IsActive = 1
              AND EffectiveFrom <= @from
              AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
          `);
        const assigned = new Set(assignments.recordset.map((b: {BranchID: number}) => Number(b.BranchID)));
        if (enabled.some((b) => !assigned.has(b.branchId))) {
          throw new Error('لازم تعيين الموظف على الفرع قبل تفعيل مرتبه');
        }
      } else {
        const amount = Number(body.globalMonthlySalary);
        if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) {
          throw new Error('حدد قيمة المرتب الشهري العام عند الرجوع للنظام العادي');
        }
        const home = await new sql.Request(tx)
          .input('empId', sql.Int, empId)
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .input('from', sql.Date, body.effectiveFrom)
          .query(`
            SELECT TOP 1 a.BranchID FROM dbo.TblEmpBranchAssignment a
            INNER JOIN dbo.Location l ON l.LegacyBranchId = a.BranchID AND l.TenantId = @tenantId
            WHERE a.EmpID = @empId AND a.IsActive = 1 AND a.EffectiveFrom <= @from
              AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @from)
            ORDER BY a.IsHomeBranch DESC, a.ID DESC
          `);
        const homeBranchId = Number(home.recordset[0]?.BranchID);
        if (!validIds.has(homeBranchId)) throw new Error('لازم تعيين فرع رئيسي للموظف قبل الرجوع للراتب العام');
        enabled = [{ branchId: homeBranchId, monthlySalary: amount, enabled: true }];
      }

      const posted = await new sql.Request(tx).input('empId', sql.Int, empId)
        .input('month', sql.NVarChar(7), body.effectiveFrom.slice(0, 7))
        .query(`SELECT TOP 1 ID FROM dbo.TblEmpLedgerEntry WHERE EmpID = @empId AND IsVoided = 0 AND EntryReason = N'monthly_salary' AND PayrollMonth >= @month`);
      if (posted.recordset.length) throw new Error('الراتب مرحل بالفعل؛ لا يمكن تغيير اتفاقية شهر مسجل');

      const oldPlans = await new sql.Request(tx)
        .input('empId', sql.Int, empId)
        .query(`
          SELECT PlanID, BranchID, PayType, MonthlySalary, EffectiveFrom, EffectiveTo
          FROM dbo.TblEmpBranchPayrollPlan WITH (UPDLOCK, HOLDLOCK)
          WHERE EmpID = @empId AND IsActive = 1
          ORDER BY BranchID, EffectiveFrom
        `);
      const future = oldPlans.recordset.some((p: {EffectiveFrom: Date | string}) =>
        new Date(p.EffectiveFrom).toISOString().slice(0, 10) > body.effectiveFrom!);
      if (future) {
        throw new Error('توجد اتفاقية تبدأ في نفس الشهر أو شهر لاحق. راجع خطط المرتبات قبل تغيير النظام');
      }

      // Replacing a not-yet-effective agreement for the same month is safe;
      // its previous values stay in the audit table (no posted payroll exists).
      await new sql.Request(tx)
        .input('empId', sql.Int, empId)
        .input('from', sql.Date, body.effectiveFrom)
        .query(`DELETE FROM dbo.TblEmpBranchPayrollPlan
          WHERE EmpID = @empId AND EffectiveFrom = @from AND IsActive = 1`);

      await new sql.Request(tx)
        .input('empId', sql.Int, empId)
        .input('from', sql.Date, body.effectiveFrom)
        .query(`
          UPDATE dbo.TblEmpBranchPayrollPlan
            SET EffectiveTo = DATEADD(DAY, -1, @from)
          WHERE EmpID = @empId AND IsActive = 1
            AND EffectiveFrom < @from
            AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
        `);

      for (const b of enabled) {
        await new sql.Request(tx)
          .input('empId', sql.Int, empId)
          .input('branchId', sql.Int, b.branchId)
          .input('amount', sql.Decimal(12, 2), b.monthlySalary)
          .input('from', sql.Date, body.effectiveFrom)
          .input('notes', sql.NVarChar(200), body.mode === 'branch_monthly'
            ? 'VIP independent monthly branch salary' : 'Return to global monthly agreement')
          .query(`
            INSERT INTO dbo.TblEmpBranchPayrollPlan
              (EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
               EffectiveFrom, EffectiveTo, IsActive, SourceNotes)
            VALUES (@empId, @branchId, N'monthly', NULL, NULL, @amount, @from, NULL, 1, @notes)
          `);
      }

      await new sql.Request(tx)
        .input('empId', sql.Int, empId)
        .input('tenantId', sql.UniqueIdentifier, tenantId)
        .input('scope', sql.NVarChar(20), body.mode)
        .input('from', sql.Date, body.effectiveFrom)
        .query(`
          UPDATE dbo.TblEmp
          SET PayrollScope = @scope, PayrollScopeEffectiveFrom = @from
          WHERE EmpID = @empId AND TenantId = @tenantId
        `);

      await new sql.Request(tx)
        .input('empId', sql.Int, empId)
        .input('from', sql.Date, body.effectiveFrom)
        .input('oldScope', sql.NVarChar(20), employee.PayrollScope || 'global')
        .input('scope', sql.NVarChar(20), body.mode)
        .input('before', sql.NVarChar(sql.MAX), JSON.stringify(oldPlans.recordset))
        .input('after', sql.NVarChar(sql.MAX), JSON.stringify(enabled))
        .input('userId', sql.Int, userId)
        .query(`
          INSERT dbo.TblEmpBranchPayrollAudit
            (EmpID, EffectiveFrom, OldPayrollScope, NewPayrollScope,
             BeforeJson, AfterJson, ChangedByUserID)
          VALUES (@empId, @from, @oldScope, @scope, @before, @after, @userId)
        `);
      await tx.commit();
      return NextResponse.json({ success: true, mode: body.mode, effectiveFrom: body.effectiveFrom,
        total: enabled.reduce((sum, b) => sum + b.monthlySalary, 0), branchCount: enabled.length });
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'تعذر حفظ مرتبات الفروع';
    console.error('[branch-compensation PUT]', err);
    return error(message, /غير موجود/.test(message) ? 404 : 400);
  }
}
