/**
 * Partners monthly report → clean multi-page A4 PDF.
 * Each logical page is rendered separately so content never splits mid-row.
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import type { PartnersMonthlyReportResponse } from '@/lib/types/partners-report';
import {
  calculateMonthlyFinancialEquations,
  formatPartnerPercentage,
} from '@/lib/reports/monthlyFinancialEquations';
import { getPrintBrandHtml } from '@/lib/tenant/tenantBrandClient';
import {
  ARABIC_MONTHS,
  partnersEmployeePaidTotal,
} from '@/components/reports/partners/partnersReportUtils';

/** A4 at 96dpi ≈ 794×1123 CSS px */
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123;
const PDF_SCALE = 2;
const EMPLOYEES_PER_PAGE = 16;

function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return (
    new Intl.NumberFormat('ar-EG', {
      style: 'decimal',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(safe) + ' ج.م'
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatGeneratedAt(date: Date): string {
  return date.toLocaleString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function waitForFonts(): Promise<void> {
  try {
    await document.fonts.ready;
  } catch {
    // ignore — fall back to system Arabic fonts
  }
  // Give Google Fonts a short window; don't block forever if offline.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

export type PartnersReportPdfInput = {
  report: PartnersMonthlyReportResponse;
  title: string;
  subtitle?: string;
  year: number;
  month: number;
};

function sharedStyles(): string {
  return `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      width: ${A4_WIDTH_PX}px;
      background: #ffffff;
      color: #111827;
      font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      direction: rtl;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }
    .page {
      width: ${A4_WIDTH_PX}px;
      height: ${A4_HEIGHT_PX}px;
      padding: 48px 44px 56px;
      background: #ffffff;
      position: relative;
      overflow: hidden;
    }
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 14px;
      margin-bottom: 22px;
      border-bottom: 3px solid #0f766e;
    }
    .brand {
      color: #0f766e;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .header-title {
      color: #111827;
      font-size: 18px;
      font-weight: 800;
      margin-top: 2px;
    }
    .header-period {
      color: #4b5563;
      font-size: 13px;
      font-weight: 600;
      text-align: left;
      white-space: nowrap;
    }
    .section-title {
      font-size: 17px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 6px;
    }
    .section-note {
      font-size: 11px;
      color: #6b7280;
      margin-bottom: 16px;
    }
    .cards { display: grid; gap: 10px; margin-bottom: 18px; }
    .card {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
    }
    .card.ok { background: #ecfdf5; border-color: #a7f3d0; }
    .card.warn { background: #fffbeb; border-color: #fde68a; }
    .card.danger { background: #fef2f2; border-color: #fecaca; }
    .card.info { background: #eff6ff; border-color: #bfdbfe; }
    .label { font-size: 13px; color: #4b5563; font-weight: 600; }
    .value { font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .emerald { color: #047857; }
    .rose { color: #be123c; }
    .amber { color: #b45309; }
    .sky { color: #0369a1; }
    .ink { color: #111827; }
    table.data {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    table.data th {
      background: #134e4a;
      color: #ffffff;
      font-size: 11px;
      font-weight: 700;
      padding: 9px 8px;
      text-align: right;
    }
    table.data td {
      font-size: 11px;
      padding: 8px;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: middle;
      word-break: break-word;
    }
    table.data tbody tr:nth-child(even) td { background: #f9fafb; }
    table.data tbody tr:nth-child(odd) td { background: #ffffff; }
    table.data tr.total td {
      background: #f0fdfa !important;
      border-top: 2px solid #0f766e;
      font-weight: 800;
    }
    .num {
      text-align: left;
      font-variant-numeric: tabular-nums;
      font-weight: 700;
      white-space: nowrap;
    }
    .name { font-weight: 700; color: #111827; }
    .badge {
      display: inline-block;
      margin-inline-start: 6px;
      padding: 1px 7px;
      border-radius: 999px;
      background: #fef3c7;
      color: #92400e;
      font-size: 9px;
      font-weight: 800;
    }
    .equation {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 18px;
    }
    .equation-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid #e5e7eb;
      background: #ffffff;
    }
    .equation-row:last-child { border-bottom: none; }
    .equation-row.final {
      background: #ecfdf5;
      padding-top: 14px;
      padding-bottom: 14px;
    }
    .equation-row.final .value { font-size: 20px; }
    .footer {
      position: absolute;
      left: 44px;
      right: 44px;
      bottom: 22px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      color: #9ca3af;
      font-size: 10px;
      border-top: 1px solid #f3f4f6;
      padding-top: 8px;
    }
    .cover {
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 10px;
    }
    .logo {
      width: 84px;
      height: 84px;
      border-radius: 50%;
      background: #0f766e;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 10px;
    }
    .cover-brand { color: #0f766e; font-size: 15px; font-weight: 700; }
    .cover-title { color: #111827; font-size: 28px; font-weight: 800; margin-top: 4px; }
    .cover-sub { color: #6b7280; font-size: 13px; max-width: 460px; }
    .cover-period {
      margin-top: 10px;
      color: #0f766e;
      font-size: 22px;
      font-weight: 800;
      padding: 8px 18px;
      border: 2px solid #99f6e4;
      border-radius: 999px;
      background: #f0fdfa;
    }
    .cover-meta { margin-top: 28px; color: #9ca3af; font-size: 11px; }
    .cover-line {
      width: 120px;
      height: 3px;
      background: #0f766e;
      border-radius: 999px;
      margin: 8px 0 4px;
    }
  `;
}

function pageShell(
  inner: string,
  footerLeft: string,
  pageNumber: number,
  totalPages: number
): string {
  return `
    <div class="page">
      ${inner}
      <div class="footer">
        <span>${escapeHtml(footerLeft)}</span>
        <span>صفحة ${pageNumber} من ${totalPages}</span>
      </div>
    </div>
  `;
}

function headerHtml(brandName: string, title: string, periodLabel: string): string {
  return `
    <div class="page-header">
      <div>
        <div class="brand">${escapeHtml(brandName)}</div>
        <div class="header-title">${escapeHtml(title)}</div>
      </div>
      <div class="header-period">${escapeHtml(periodLabel)}</div>
    </div>
  `;
}

export async function generatePartnersReportPDF(input: PartnersReportPdfInput): Promise<Blob> {
  const { report, title, subtitle = 'ملخص الأداء المالي الشهري', year, month } = input;
  const monthName = ARABIC_MONTHS[month - 1] ?? String(month);
  const periodLabel = `${monthName} ${year}`;
  const brand = getPrintBrandHtml();
  const brandName = brand.name || 'نظام نقاط البيع';
  const brandInitials =
    brandName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w.charAt(0))
      .join('') || 'P';

  const shopRevenue = report.employeeSummaryTotals.totalShopRevenue;
  const storeIncome = report.summary.storeOtherBusinessIncome ?? 0;
  const paidEmployees = partnersEmployeePaidTotal(report.employeeSummaryTotals);
  const operatingExpenses = report.summary.operatingExpenses;
  const hasManualEmployeeNumbers = report.employeeSummary.some((row) => row.hasSpecialAccounting);
  const classifiedNet = !hasManualEmployeeNumbers
    ? report.classifiedPartnerSplit?.cleanNetProfit
    : undefined;
  const operatingNet = classifiedNet ?? report.summary.operatingNet;

  const partners = report.partners ?? [];
  if (partners.length === 0) {
    throw new Error('لا توجد نسب شركاء متاحة لهذا التقرير — لا يمكن تصدير PDF');
  }

  const settlement = calculateMonthlyFinancialEquations({
    year,
    month,
    baseAmount: operatingNet,
    mode: 'partners',
    partners,
    baseAmountAlreadyNetOfEmployees: classifiedNet == null,
    baseAmountAlreadyNetOfOperatingExpenses: classifiedNet != null,
  });

  const employeesSorted = [...report.employeeSummary].sort(
    (a, b) => (b.shopRevenue ?? -1) - (a.shopRevenue ?? -1)
  );
  const employeeChunks = chunkArray(employeesSorted, EMPLOYEES_PER_PAGE);
  const generatedAt = formatGeneratedAt(new Date(report.metadata?.generatedAt ?? Date.now()));

  const expenseTxnCount = report.expensesByCategory.reduce((s, r) => s + r.transactionCount, 0);
  const expenseRows =
    report.expensesByCategory.length === 0
      ? `<tr><td colspan="4" style="text-align:center;color:#6b7280;padding:24px;">لا توجد مصروفات تشغيل</td></tr>`
      : report.expensesByCategory
          .map(
            (row) => `
          <tr>
            <td class="name">${escapeHtml(row.categoryName)}</td>
            <td class="num">${row.transactionCount}</td>
            <td class="num rose">${formatCurrency(row.totalAmount)}</td>
            <td class="num">${row.percentage.toFixed(1)}%</td>
          </tr>`
          )
          .join('');

  const partnerRows = settlement.partnerShares
    .map(
      (p) => `
      <tr>
        <td class="name">${escapeHtml(p.name)}</td>
        <td class="num">${formatPartnerPercentage(p.percentage)}</td>
        <td class="num emerald">${formatCurrency(p.profitShare)}</td>
      </tr>`
    )
    .join('');

  const totalPages = 2 + employeeChunks.length + 2; // cover + summary + employees + expenses + settlement

  const coverInner = `
      <div class="cover">
        <div class="logo">${escapeHtml(brandInitials)}</div>
        <div class="cover-brand">${escapeHtml(brandName)}</div>
        <div class="cover-line"></div>
        <div class="cover-title">${escapeHtml(title)}</div>
        <div class="cover-sub">${escapeHtml(subtitle)}</div>
        <div class="cover-period">${escapeHtml(periodLabel)}</div>
        <div class="cover-meta">تاريخ الإنشاء: ${escapeHtml(generatedAt)}</div>
      </div>
    `;

  const summaryInner = `
      ${headerHtml(brandName, title, periodLabel)}
      <h2 class="section-title">الملخص المالي للشهر</h2>
      <p class="section-note">من إيراد المحل حتى الصافي المستخدم في تسوية الشركاء</p>
      <div class="cards">
        <div class="card">
          <span class="label">دخل الموظفين للمحل</span>
          <span class="value emerald">${formatCurrency(shopRevenue)}</span>
        </div>
        ${
          storeIncome > 0
            ? `<div class="card info">
                <span class="label">+ إيراد آخر للمحل</span>
                <span class="value sky">${formatCurrency(storeIncome)}</span>
              </div>`
            : ''
        }
        <div class="card warn">
          <span class="label">− رواتب وسلف الموظفين</span>
          <span class="value amber">${formatCurrency(paidEmployees)}</span>
        </div>
        <div class="card danger">
          <span class="label">− مصروفات التشغيل</span>
          <span class="value rose">${formatCurrency(operatingExpenses)}</span>
        </div>
        <div class="card ok">
          <span class="label">${classifiedNet != null ? 'صافي الربح النظيف' : 'صافي التشغيل'}</span>
          <span class="value ${operatingNet < 0 ? 'rose' : 'emerald'}">${formatCurrency(operatingNet)}</span>
        </div>
      </div>
      <div class="equation">
        <div class="equation-row">
          <span class="label">إجمالي إيراد التقرير</span>
          <span class="value emerald">${formatCurrency(report.summary.totalRevenue)}</span>
        </div>
        <div class="equation-row">
          <span class="label">إجمالي مصروفات الشهر</span>
          <span class="value rose">${formatCurrency(report.summary.totalExpenses)}</span>
        </div>
        <div class="equation-row">
          <span class="label">مستبعد من التشغيل (تسويات موظفين)</span>
          <span class="value ink">${formatCurrency(report.summary.excludedEmployeeSettlementExpenses)}</span>
        </div>
      </div>
    `;

  const employeeInners = employeeChunks.map((chunk, chunkIndex) => {
    const rows =
      chunk.length === 0
        ? `<tr><td colspan="5" style="text-align:center;color:#6b7280;padding:24px;">لا توجد بيانات موظفين</td></tr>`
        : chunk
            .map(
              (row) => `
            <tr>
              <td class="name">${escapeHtml(row.employeeName)}${
                row.hasSpecialAccounting ? '<span class="badge">معدل</span>' : ''
              }</td>
              <td class="num emerald">${
                row.shopRevenue == null ? '—' : formatCurrency(row.shopRevenue)
              }</td>
              <td class="num">${formatCurrency(row.salaryAndTarget)}</td>
              <td class="num">${formatCurrency(row.advanceExcess)}</td>
              <td class="num amber">${formatCurrency(row.paidSalaryAndAdvances)}</td>
            </tr>`
            )
            .join('');

    const showTotals = chunkIndex === employeeChunks.length - 1;
    const totalsRow = showTotals
      ? `<tr class="total">
          <td>الإجمالي</td>
          <td class="num emerald">${formatCurrency(shopRevenue)}</td>
          <td class="num">${formatCurrency(report.employeeSummaryTotals.totalSalaryAndTarget ?? 0)}</td>
          <td class="num">${formatCurrency(report.employeeSummaryTotals.totalAdvanceExcess ?? 0)}</td>
          <td class="num amber">${formatCurrency(paidEmployees)}</td>
        </tr>`
      : '';

    const partLabel =
      employeeChunks.length > 1
        ? `تفاصيل الموظفين (${chunkIndex + 1}/${employeeChunks.length})`
        : 'تفاصيل الموظفين';

    return `
        ${headerHtml(brandName, title, periodLabel)}
        <h2 class="section-title">${partLabel}</h2>
        <p class="section-note">استلم راتب = راتب + تارجت. سلف = السحب الزائد بعد الاستحقاق والتمويل.</p>
        <table class="data">
          <colgroup>
            <col style="width:28%" />
            <col style="width:18%" />
            <col style="width:18%" />
            <col style="width:18%" />
            <col style="width:18%" />
          </colgroup>
          <thead>
            <tr>
              <th>الموظف</th>
              <th>دخل للمحل</th>
              <th>استلم راتب</th>
              <th>سلف</th>
              <th>إجمالي المدفوع</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${totalsRow}
          </tbody>
        </table>
      `;
  });

  const expensesInner = `
      ${headerHtml(brandName, title, periodLabel)}
      <h2 class="section-title">مصروفات التشغيل حسب الفئة</h2>
      <p class="section-note">بعد استبعاد سلف وتارجت الموظفين من إجمالي المصروفات</p>
      <table class="data">
        <colgroup>
          <col style="width:46%" />
          <col style="width:18%" />
          <col style="width:20%" />
          <col style="width:16%" />
        </colgroup>
        <thead>
          <tr>
            <th>الفئة</th>
            <th>عدد الحركات</th>
            <th>المبلغ</th>
            <th>النسبة</th>
          </tr>
        </thead>
        <tbody>
          ${expenseRows}
          <tr class="total">
            <td>إجمالي مصروفات التشغيل</td>
            <td class="num">${expenseTxnCount}</td>
            <td class="num rose">${formatCurrency(operatingExpenses)}</td>
            <td class="num">100%</td>
          </tr>
        </tbody>
      </table>
    `;

  const settlementInner = `
      ${headerHtml(brandName, title, periodLabel)}
      <h2 class="section-title">التسوية والتوزيع النهائي للشركاء</h2>
      <p class="section-note">خصم نسبة إدارة 5% ثم التوزيع حسب نسب الفرع</p>
      <div class="equation">
        <div class="equation-row">
          <span class="label">${
            classifiedNet != null ? 'صافي الربح النظيف' : 'صافي التشغيل المستخدم كبداية'
          }</span>
          <span class="value emerald">${formatCurrency(settlement.baseAmount)}</span>
        </div>
        <div class="equation-row">
          <span class="label">نسبة الإدارة ${settlement.managementFeePercent}%</span>
          <span class="value amber">− ${formatCurrency(settlement.managementFeeAmount)}</span>
        </div>
        <div class="equation-row final">
          <span class="label">${
            settlement.isLoss ? 'خسارة قابلة للتوزيع' : 'المبلغ النهائي القابل للتوزيع'
          }</span>
          <span class="value ${settlement.isLoss ? 'rose' : 'emerald'}">${formatCurrency(
            settlement.finalDistributableAmount
          )}</span>
        </div>
      </div>
      <table class="data">
        <colgroup>
          <col style="width:46%" />
          <col style="width:24%" />
          <col style="width:30%" />
        </colgroup>
        <thead>
          <tr>
            <th>الشريك</th>
            <th>النسبة</th>
            <th>نصيب الربح</th>
          </tr>
        </thead>
        <tbody>
          ${partnerRows}
          <tr class="total">
            <td>إجمالي المبالغ الموزعة</td>
            <td class="num">${partners.reduce((s, p) => s + p.percentage, 0).toFixed(4)}%</td>
            <td class="num emerald">${formatCurrency(settlement.totalPartnerShares)}</td>
          </tr>
        </tbody>
      </table>
    `;

  const numberedPages = [
    pageShell(coverInner, brandName, 1, totalPages),
    pageShell(summaryInner, brandName, 2, totalPages),
    ...employeeInners.map((inner, i) =>
      pageShell(inner, brandName, 3 + i, totalPages)
    ),
    pageShell(expensesInner, brandName, 3 + employeeInners.length, totalPages),
    pageShell(settlementInner, brandName, 4 + employeeInners.length, totalPages),
  ];

  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.left = '-10000px';
  wrapper.style.top = '0';
  wrapper.style.width = `${A4_WIDTH_PX}px`;
  wrapper.style.background = '#ffffff';
  wrapper.style.zIndex = '-1';
  wrapper.setAttribute('dir', 'rtl');
  wrapper.innerHTML = `
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
    <style>${sharedStyles()}</style>
    <div id="partners-pdf-pages">${numberedPages.join('')}</div>
  `;
  document.body.appendChild(wrapper);

  try {
    await waitForFonts();

    const pageNodes = Array.from(
      wrapper.querySelectorAll<HTMLElement>('#partners-pdf-pages > .page')
    );
    if (pageNodes.length === 0) {
      throw new Error('تعذر تجهيز صفحات التقرير للطباعة');
    }

    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true,
    });

    for (let i = 0; i < pageNodes.length; i++) {
      const node = pageNodes[i];
      const canvas = await html2canvas(node, {
        scale: PDF_SCALE,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        width: A4_WIDTH_PX,
        height: A4_HEIGHT_PX,
        windowWidth: A4_WIDTH_PX,
        windowHeight: A4_HEIGHT_PX,
        logging: false,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
    }

    return pdf.output('blob');
  } finally {
    if (wrapper.parentNode) {
      document.body.removeChild(wrapper);
    }
  }
}

export function downloadPDF(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
