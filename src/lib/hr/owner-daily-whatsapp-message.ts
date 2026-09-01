/**
 * Pure WhatsApp message composer for owner daily digest (manager / Tarek).
 */

import type { FullDayReport } from '@/lib/reports/full-day-report.types';
import { formatTime12hAr } from '@/lib/reports/reportFormatters';
import { formatTargetBreakdownLinesAr } from '@/lib/payroll/employee-target/mtd-target-snapshot';

function money(value: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return `${formatted} ج.م`;
}

function moneySigned(value: number, forceMinus = false): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  if (forceMinus || value < 0) return `\u2212${formatted} ج.م`;
  return `${formatted} ج.م`;
}

function moneyStar(value: number): string {
  return `*${money(value)}*`;
}

function moneyStarSigned(value: number): string {
  return `*${moneySigned(value)}*`;
}

function outflowStar(value: number): string {
  if (value <= 0.009) return moneyStar(0);
  return `*${moneySigned(value, true)}*`;
}

function moneyPlain(value: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function moneyPlainSigned(value: number): string {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));
  return value < 0 ? `\u2212${formatted}` : formatted;
}

function transactionsLabel(count: number): string {
  if (count <= 0) return '';
  if (count === 1) return 'حركة';
  if (count === 2) return 'حركتان';
  if (count >= 3 && count <= 10) return `${count} حركات`;
  return `${count} حركة`;
}

function advancesLabel(count: number): string {
  if (count <= 0) return '';
  if (count === 1) return '';
  if (count === 2) return 'سلفتان';
  if (count >= 3 && count <= 10) return `${count} سلف`;
  return `${count} سلفة`;
}

function treasuryNetToday(report: FullDayReport): number {
  const t = report.treasury;
  return t.inflows.total - t.outflows.total;
}

export function composeOwnerDailyWhatsAppMessage(
  report: FullDayReport,
  options?: { branchName?: string | null },
): string {
  const dateLabel = report.workDateLabelAr;
  const branchName = options?.branchName?.trim() || null;
  const o = report.ownerDay;
  const t = report.treasury;
  const a = report.employeeAccounts;
  const treasuryTodayNet = treasuryNetToday(report);

  const lines: string[] = [];

  if (branchName) {
    lines.push(`📊 *تقفيل اليوم — ${branchName}*`);
    lines.push(`📅 ${dateLabel}`);
  } else {
    lines.push(`📊 *تقفيل اليوم — ${dateLabel}*`);
  }
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*1️⃣ الربحية (تشغيل)*');
  lines.push('');
  lines.push(`وارد: مبيعات ${moneyStar(o.sales)} + إيرادات ${moneyStar(o.incomes)}`);
  lines.push(`= *${money(o.sales + o.incomes)}*`);
  lines.push('');
  lines.push(`صادر: مصروفات ${outflowStar(o.operatingExpenses)}`);
  lines.push(`+ أساسي ${outflowStar(o.staffBase)} + تارجت اليوم ${outflowStar(o.staffTarget)}`);
  lines.push(`= *${money(o.totalOut)}*`);
  lines.push('');
  lines.push(`✅ صافي ربح التشغيل: ${moneyStarSigned(o.net)}`);
  lines.push('_الربح يخصم استحقاقات الموظفين (أساسي + تارجت) ولا يخصم السلف._');
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*2️⃣ طرق الدفع (وارد اليوم)*');
  lines.push('');

  const mix = report.paymentMix;
  if (!mix || mix.rows.length === 0) {
    lines.push('• لا يوجد وارد اليوم');
  } else {
    for (const row of mix.rows) {
      const pct = row.percent > 0 ? ` (${row.percent}%)` : '';
      lines.push(`• ${row.method}: ${moneyStar(row.total)}${pct}`);
    }
    lines.push('');
    lines.push(`*إجمالي الوارد: ${money(mix.total)}*`);
    lines.push(`_(مبيعات ${money(mix.salesTotal)} + إيرادات ${money(mix.incomesTotal)})_`);
  }
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*3️⃣ الخزنة (فلوس فعلية)*');
  lines.push('');
  lines.push(`*داخل الخزنة: ${money(t.inflows.total)}*`);
  lines.push(`• مبيعات: ${money(t.inflows.sales)}`);
  lines.push(`• إيرادات: ${money(t.inflows.incomes)}`);
  lines.push('');
  lines.push(`*خرج من الخزنة: ${money(t.outflows.total)}*`);
  lines.push(`• مصروفات تشغيل: ${money(t.outflows.operatingTotal)}`);
  lines.push(`• سلف موظفين: ${money(t.outflows.advancesTotal)}`);
  lines.push('');
  lines.push(`💵 صافي الخزنة اليوم: ${moneyStarSigned(treasuryTodayNet)}`);
  lines.push('_(داخل − خارج — السلف تُحسب خروج فعلي من الخزنة)_');
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*4️⃣ مصروفات التشغيل*');
  lines.push('');

  if (t.outflows.operatingByCategory.length === 0) {
    lines.push('• لا توجد مصروفات تشغيل');
  } else {
    lines.push('▪️ *حسب التصنيف:*');
    for (const row of t.outflows.operatingByCategory) {
      const tx = transactionsLabel(row.count);
      lines.push(
        tx
          ? `• ${row.label}: ${moneyStar(row.amount)} — ${tx}`
          : `• ${row.label}: ${moneyStar(row.amount)}`,
      );
    }

    const expenseItems = report.expenses.lines;
    if (expenseItems.length > 0) {
      lines.push('');
      lines.push('▪️ *البنود بالتفصيل:*');
      let idx = 1;
      for (const item of expenseItems) {
        lines.push(`${idx}. ${item.label}: ${moneyStar(item.amount)}`);
        if (item.meta) lines.push(`    ↳ ${item.meta}`);
        idx += 1;
      }
      if (report.expenses.count > expenseItems.length) {
        lines.push(
          `_( + ${report.expenses.count - expenseItems.length} بند إضافي غير معروض )_`,
        );
      }
    }
  }
  lines.push('');
  lines.push(`*الإجمالي: ${money(t.outflows.operatingTotal)}*`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*5️⃣ سلف الموظفين*');
  lines.push('');

  if (t.outflows.advancesByEmployee.length === 0) {
    lines.push('• لا توجد سلف اليوم');
  } else {
    for (const row of t.outflows.advancesByEmployee) {
      const adv = advancesLabel(row.count);
      lines.push(
        adv
          ? `• ${row.label}: ${moneyStar(row.amount)} — ${adv}`
          : `• ${row.label}: ${moneyStar(row.amount)}`,
      );
    }
  }
  lines.push('');
  lines.push(`*إجمالي السلف: ${money(t.outflows.advancesTotal)}*`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*6️⃣ الموظفين*');
  lines.push('');
  lines.push(`*استحقاق اليوم: ${money(a.totalDayCost)}*`);
  lines.push(`*سلف اليوم: ${money(a.totalAdvancesToday)}*`);
  lines.push(`*مجموع أرصدة المعروضين: ${money(a.totalLedgerBalance)}*`);
  lines.push('');

  const accountRows = [...a.rows].sort((x, y) =>
    x.empName.localeCompare(y.empName, 'ar'),
  );

  for (const row of accountRows) {
    const hasTargetContext =
      row.dayTarget > 0 ||
      row.dayBase > 0 ||
      (row.mtdTargetAmount != null && row.mtdTargetAmount > 0) ||
      (row.mtdSales != null && row.mtdSales > 0);

    lines.push(`• *${row.empName}*`);

    if (row.payType === 'monthly' && row.monthlySalary != null && row.monthlySalary > 0) {
      lines.push(`راتب شهري (الفرع): *${moneyPlain(row.monthlySalary)}*`);
      if (row.monthlySalaryLedger != null && row.monthlySalaryLedger > 0) {
        lines.push(`مسجّل في الدفتر (الشهر): *${moneyPlain(row.monthlySalaryLedger)}*`);
      } else {
        lines.push('مسجّل في الدفتر (الشهر): لم يُرحَّل بعد');
      }
    }

    if (row.dayBase > 0 || row.dayTarget > 0) {
      const parts: string[] = [];
      if (row.dayBase > 0) parts.push(`أساسي ${moneyPlain(row.dayBase)}`);
      if (row.dayTarget > 0) parts.push(`تارجت اليوم ${moneyPlain(row.dayTarget)}`);
      lines.push(parts.join(' + '));
    }

    if (hasTargetContext && row.mtdTargetAmount != null) {
      lines.push(`تارجت الشهر حتى اليوم: *${moneyPlain(row.mtdTargetAmount)}*`);
      if (row.mtdSales != null) {
        lines.push(`مبيعات الشهر: ${moneyPlain(row.mtdSales)}`);
      }
      if (row.mtdTargetAmount <= 0 && row.mtdSales != null && row.mtdSales > 0) {
        lines.push('تحت أول شريحة في اتفاق التارجت — لم يُحسب تارجت بعد.');
      }
      if (row.dayTarget > 0) {
        const breakdownLines = formatTargetBreakdownLinesAr(row.targetBreakdown ?? []);
        if (breakdownLines.length > 0) {
          lines.push('حساب التارجت:');
          for (const bl of breakdownLines) lines.push(bl);
        }
      }
    }

    const advancePart =
      row.advancesToday > 0
        ? `سلف: *${moneyPlain(row.advancesToday)}*`
        : 'بدون سلف';
    const entitlementLabel =
      row.payType === 'monthly' ? 'يومية اليوم' : 'استحقاق اليوم';
    lines.push(`${entitlementLabel}: *${moneyPlain(row.dayTotal)}* | ${advancePart}`);
    lines.push(`رصيد الحساب: *${moneyPlainSigned(row.ledgerBalance)} ج.م*`);
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━');
  lines.push('*7️⃣ الحضور*');
  lines.push('');

  const attendanceRows = report.payroll.employees;
  if (attendanceRows.length === 0) {
    lines.push('• لا توجد بيانات حضور لليوم');
  } else {
    const present = attendanceRows.filter((e) => e.checkIn);
    const absent = attendanceRows.filter((e) => !e.checkIn);
    lines.push(`حضور *${present.length}* · غياب *${absent.length}*`);
    lines.push('');

    if (present.length > 0) {
      lines.push('*حضور:*');
      for (const emp of present) {
        const inLabel = formatTime12hAr(emp.checkIn) ?? emp.checkIn;
        const outLabel = emp.checkOut
          ? (formatTime12hAr(emp.checkOut) ?? emp.checkOut)
          : '—';
        lines.push(`• ${emp.empName}: ${inLabel} → ${outLabel}`);
      }
    }

    if (absent.length > 0) {
      lines.push('');
      lines.push('*بدون حضور:*');
      for (const emp of absent) {
        lines.push(`• ${emp.empName}`);
      }
    }
  }
  lines.push('');

  lines.push('━━━━━━━━━━━━━━');
  lines.push('*ملخص سريع*');
  lines.push('');
  lines.push(`✅ ربح التشغيل: ${moneyStarSigned(o.net)}`);
  lines.push(`💵 صافي الخزنة: ${moneyStarSigned(treasuryTodayNet)}`);
  lines.push(`👥 استحقاقات اليوم: *${money(a.totalDayCost)}*`);
  lines.push(`💸 سلف اليوم: *${money(a.totalAdvancesToday)}*`);

  const mtd = report.monthToDate;
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push(`*📆 تراكمي الشهر (${mtd.month})*`);
  lines.push('');
  lines.push(`💰 ربح التشغيل حتى اليوم: *${money(mtd.netProfit)}*`);
  lines.push(`🏦 سيولة الخزنة حتى اليوم: ${moneyStarSigned(mtd.treasuryNet)}`);
  lines.push('_الربح الشهري = وارد − (مصروفات + أساسي + تارجت) · الخزنة = وارد − (مصروفات + سلف)_');

  return lines.join('\n');
}
