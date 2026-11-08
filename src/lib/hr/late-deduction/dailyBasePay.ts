import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  getEffectiveHourlyRate,
  resolvePayrollMethod,
  scheduledHoursFromTimes,
  type PayrollEmployeeRow,
} from '@/lib/payroll/dailyPayrollHrRules';
import { resolveBranchPayrollPlanForDate } from '@/lib/payroll/branchPayrollPlan';
import { roundMoney } from '@/lib/reportMonthUtils';
import {
  dailyBasePayFromHourly,
  dailyBasePayFromMonthlySalary,
} from './rules';

export interface LateDeductionPayBasis {
  dailyBasePay: number | null;
  source:
    | 'monthly_salary'
    | 'hourly_scheduled'
    | 'daily_rate'
    | 'missing';
  payrollMethod: string | null;
  monthlySalary: number | null;
  hourlyRate: number | null;
  scheduledHours: number | null;
  reason?: string;
}

export async function resolveLateDeductionDailyBasePay(params: {
  empId: number;
  branchId: number;
  workDate: string;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
}): Promise<LateDeductionPayBasis> {
  const db = await getPool();
  const empResult = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .query(`
      SELECT
        EmpID,
        EmpName,
        isActive,
        ISNULL(IsPayrollEnabled, 1) AS IsPayrollEnabled,
        EmploymentType,
        PayrollMethod,
        SalaryType,
        ManualHourlyRate,
        HourlyRate,
        DailyRate,
        BaseSalary,
        Salary
      FROM dbo.TblEmp
      WHERE EmpID = @empId
    `);

  const emp = empResult.recordset[0] as PayrollEmployeeRow | undefined;
  if (!emp) {
    return {
      dailyBasePay: null,
      source: 'missing',
      payrollMethod: null,
      monthlySalary: null,
      hourlyRate: null,
      scheduledHours: null,
      reason: 'employee_not_found',
    };
  }

  const method = resolvePayrollMethod(emp);
  const scheduledHours = scheduledHoursFromTimes(params.scheduledStart, params.scheduledEnd);
  const plan = await resolveBranchPayrollPlanForDate({
    empId: params.empId,
    branchId: params.branchId,
    workDate: params.workDate,
  });

  if (method === 'monthly' || plan?.payType === 'monthly') {
    const monthly =
      (plan?.payType === 'monthly' && plan.monthlySalary != null && plan.monthlySalary > 0
        ? Number(plan.monthlySalary)
        : null) ??
      (emp.BaseSalary != null && Number(emp.BaseSalary) > 0 ? Number(emp.BaseSalary) : null) ??
      (emp.Salary != null && Number(emp.Salary) > 0 ? Number(emp.Salary) : null);

    if (monthly == null || !(monthly > 0)) {
      return {
        dailyBasePay: null,
        source: 'missing',
        payrollMethod: 'monthly',
        monthlySalary: null,
        hourlyRate: null,
        scheduledHours,
        reason: 'missing_monthly_salary',
      };
    }

    return {
      dailyBasePay: dailyBasePayFromMonthlySalary(monthly),
      source: 'monthly_salary',
      payrollMethod: 'monthly',
      monthlySalary: monthly,
      hourlyRate: null,
      scheduledHours,
    };
  }

  if (method === 'daily' || plan?.payType === 'daily') {
    const dailyRate =
      (plan?.payType === 'daily' && plan.dailyRate != null && plan.dailyRate > 0
        ? Number(plan.dailyRate)
        : null) ??
      (emp.DailyRate != null && Number(emp.DailyRate) > 0 ? Number(emp.DailyRate) : null);

    if (dailyRate == null || !(dailyRate > 0)) {
      return {
        dailyBasePay: null,
        source: 'missing',
        payrollMethod: 'daily',
        monthlySalary: null,
        hourlyRate: null,
        scheduledHours,
        reason: 'missing_daily_rate',
      };
    }

    return {
      dailyBasePay: roundMoney(dailyRate),
      source: 'daily_rate',
      payrollMethod: 'daily',
      monthlySalary: null,
      hourlyRate: null,
      scheduledHours,
    };
  }

  const planHourly =
    plan?.payType === 'hourly' && plan.hourlyRate != null && plan.hourlyRate > 0
      ? Number(plan.hourlyRate)
      : null;
  const hourlyRate =
    planHourly ??
    getEffectiveHourlyRate(
      {
        ...emp,
        ManualHourlyRate:
          emp.ManualHourlyRate != null ? Number(emp.ManualHourlyRate) : null,
        HourlyRate: emp.HourlyRate != null ? Number(emp.HourlyRate) : null,
      },
      scheduledHours,
    );

  if (hourlyRate == null || !(hourlyRate > 0)) {
    return {
      dailyBasePay: null,
      source: 'missing',
      payrollMethod: 'hourly',
      monthlySalary: null,
      hourlyRate: null,
      scheduledHours,
      reason: 'missing_hourly_rate',
    };
  }

  const daily = dailyBasePayFromHourly({
    hourlyRate,
    scheduledStart: params.scheduledStart,
    scheduledEnd: params.scheduledEnd,
  });

  if (daily == null) {
    return {
      dailyBasePay: null,
      source: 'missing',
      payrollMethod: 'hourly',
      monthlySalary: null,
      hourlyRate,
      scheduledHours,
      reason: 'missing_schedule_hours',
    };
  }

  return {
    dailyBasePay: daily,
    source: 'hourly_scheduled',
    payrollMethod: 'hourly',
    monthlySalary: null,
    hourlyRate,
    scheduledHours,
  };
}
