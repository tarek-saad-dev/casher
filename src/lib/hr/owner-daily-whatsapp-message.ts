/**
 * Pure WhatsApp message composer for owner daily digest (manager / Tarek).
 * Keep strings ASCII-safe in source where possible; Arabic via plain UTF-8 carefully.
 */

import type { FullDayReport } from '@/lib/reports/full-day-report.types';
import { formatTime12hAr } from '@/lib/reports/reportFormatters';

function money(value: number): string {
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
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

export function composeOwnerDailyWhatsAppMessage(report: FullDayReport): string {
  const dateLabel = report.workDateLabelAr;
  const o = report.ownerDay;
  const t = report.treasury;
  const a = report.employeeAccounts;

  const lines: string[] = [];

  lines.push(`📊 *تقرير المالك اليومي — ${dateLabel}*`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*1️⃣ نتيجة التشغيل*');
  lines.push('');
  lines.push(`• المبيعات: ${moneyStar(o.sales)}`);
  lines.push(`• إيرادات أخرى: ${moneyStar(o.incomes)}`);
  lines.push(`• مصروفات التشغيل: *${moneySigned(o.operatingExpenses, true)}*`);
  lines.push(`• أساسي الموظفين: *${moneySigned(o.staffBase, true)}*`);
  lines.push(`• تارجت الموظفين: *${moneySigned(o.staffTarget, true)}*`);
  lines.push('');
  lines.push(`✅ *صافي ربح اليوم: ${money(o.net)}*`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*2️⃣ توزيع الفلوس على طرق الدفع*');
  lines.push('');

  const mix = report.paymentMix;
  if (!mix || mix.rows.length === 0) {
    lines.push('• لا توجد فلوس داخلة اليوم');
  } else {
    for (const row of mix.rows) {
      const pct = row.percent > 0 ? ` (${row.percent}%)` : '';
      lines.push(`• ${row.method}: ${moneyStar(row.total)}${pct}`);
    }
    lines.push('');
    lines.push(`*إجمالي الفلوس الداخلة: ${money(mix.total)}*`);
    lines.push(
      `_(مبيعات ${money(mix.salesTotal)} + إيرادات ${money(mix.incomesTotal)})_`,
    );
  }
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*3️⃣ حركة الخزنة الفعلية*');
  lines.push('');
  lines.push(`*الفلوس الداخلة: ${money(t.inflows.total)}*`);
  lines.push(`• مبيعات: ${money(t.inflows.sales)}`);
  lines.push(`• إيرادات: ${money(t.inflows.incomes)}`);
  lines.push('');
  lines.push(`*الفلوس الخارجة: ${money(t.outflows.total)}*`);
  lines.push(`• مصروفات تشغيل: ${money(t.outflows.operatingTotal)}`);
  lines.push(`• سلف موظفين: ${money(t.outflows.advancesTotal)}`);
  lines.push('');
  lines.push(`💵 *صافي حركة الخزنة: ${money(t.net)}*`);
  lines.push(`🏦 *صافي السيولة بالخزنة حتى اليوم: ${money(report.monthToDate.treasuryNet)}*`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*4️⃣ تفاصيل مصروفات التشغيل*');
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
  lines.push('*6️⃣ حسابات الموظفين*');
  lines.push('');
  lines.push(`*استحقاق اليوم: ${money(a.totalDayCost)}*`);
  lines.push(`*سلف اليوم: ${money(a.totalAdvancesToday)}*`);
  lines.push(`*إجمالي أرصدة الحسابات: ${money(a.totalLedgerBalance)}*`);
  lines.push('');

  for (const row of a.rows) {
    lines.push(`• ${row.empName}`);
    if (row.dayBase > 0 || row.dayTarget > 0) {
      const parts: string[] = [];
      if (row.dayBase > 0) parts.push(`أساسي ${moneyPlain(row.dayBase)}`);
      if (row.dayTarget > 0) parts.push(`تارجت ${moneyPlain(row.dayTarget)}`);
      lines.push(parts.join(' + '));
    }
    const advancePart =
      row.advancesToday > 0
        ? `سلف: *${moneyPlain(row.advancesToday)}*`
        : 'بدون سلف';
    lines.push(`استحقاق: *${moneyPlain(row.dayTotal)}* | ${advancePart}`);
    lines.push(`الرصيد: *${moneyPlainSigned(row.ledgerBalance)} ج.م*`);
    lines.push('');
  }

  lines.push('━━━━━━━━━━━━━━');
  lines.push('*7️⃣ مواعيد الحضور والانصراف*');
  lines.push('');

  const attendanceRows = report.payroll.employees;
  if (attendanceRows.length === 0) {
    lines.push('• لا توجد بيانات حضور لليوم');
  } else {
    for (const emp of attendanceRows) {
      if (!emp.checkIn) {
        lines.push(`• ${emp.empName}: بدون حضور`);
        continue;
      }
      const inLabel = formatTime12hAr(emp.checkIn) ?? emp.checkIn;
      const outLabel = emp.checkOut
        ? (formatTime12hAr(emp.checkOut) ?? emp.checkOut)
        : '—';
      lines.push(`• ${emp.empName}: حضور ${inLabel} | انصراف ${outLabel}`);
    }
  }
  lines.push('');

  lines.push('━━━━━━━━━━━━━━');
  lines.push('*ملخص اليوم*');
  lines.push('');
  lines.push(`✅ ربح التشغيل: *${money(o.net)}*`);
  lines.push(`💵 صافي الخزنة: *${money(t.net)}*`);
  lines.push(`👥 استحقاقات الموظفين: *${money(a.totalDayCost)}*`);
  lines.push(`💸 السلف المصروفة: *${money(a.totalAdvancesToday)}*`);
  lines.push('');
  lines.push(
    '*الربح يشمل استحقاقات الموظفين عن اليوم، بينما الخزنة تحسب الفلوس التي دخلت وخرجت فعليًا.*',
  );

  const mtd = report.monthToDate;
  lines.push('');
  lines.push('━━━━━━━━━━━━━━');
  lines.push('*📆 من أول الشهر حتى اليوم*');
  lines.push('');
  lines.push(`💰 *صافي الربح الشهري حتى اليوم: ${money(mtd.netProfit)}*`);
  lines.push(`🏦 *صافي السيولة بالخزنة حتى اليوم: ${money(mtd.treasuryNet)}*`);

  return lines.join('\n');
}
