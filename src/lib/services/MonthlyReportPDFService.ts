/**
 * Monthly Profit Report PDF Service
 * 
 * Each Item on Separate Page:
 * - Page 1: Cover
 * - Page 2: Revenue (إجمالي الوارد)
 * - Page 3: Expenses (إجمالي المصروف)
 * - Page 4: Net Profit (صافي الربح)
 * - Page 5: Partner Distribution (توزيع الشركاء)
 * 
 * Uses html2canvas + jsPDF for perfect Arabic text rendering.
 */

import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas-pro';
import type { MonthlyBusinessReport } from '@/lib/types/monthly-report';
import { calculatePartnerProfitShares } from '@/lib/reports/monthlyFinancialEquations';
import { PARTNERS } from '@/lib/types/monthly-report';

const PDF_CONFIG = {
  pageWidth: 210,
  pageHeight: 297,
  scale: 2,
};

const formatCurrency = (amount: number): string => {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ج.م';
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

interface PDFReportData {
  month: number;
  year: number;
  report: MonthlyBusinessReport;
  generatedBy?: string;
}

export async function generateMonthlyReportPDF(data: PDFReportData): Promise<Blob> {
  const { month, year, report, generatedBy = 'Hawai POS System' } = data;
  const monthName = new Date(year, month - 1).toLocaleDateString('ar-EG', { month: 'long' });
  const monthNameEn = new Date(year, month - 1).toLocaleDateString('en-US', { month: 'long' });

  // Calculate partner shares
  const partnerShares = calculatePartnerProfitShares(report.netProfit);
  const totalDistributed = partnerShares.reduce((sum, p) => sum + p.profitShare, 0);

  // Generate 5-page HTML - each item on separate page
  const htmlContent = `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Cairo', sans-serif;
      background: #111114;
      color: #e4e4e7;
      line-height: 1.6;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 20mm;
      background: #111114;
      position: relative;
      page-break-after: always;
    }
    .page:last-child { page-break-after: avoid; }
    
    /* Cover Page */
    .cover {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 257mm;
      text-align: center;
    }
    .logo {
      width: 100px;
      height: 100px;
      background: #10b981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
      font-weight: 700;
      color: white;
      margin-bottom: 40px;
    }
    .system-name {
      color: #10b981;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .report-title {
      color: #e4e4e7;
      font-size: 32px;
      font-weight: 700;
      margin-bottom: 20px;
    }
    .month-year {
      color: #3b82f6;
      font-size: 24px;
      font-weight: 600;
      margin-bottom: 30px;
    }
    .generated-info {
      color: #a1a1aa;
      font-size: 12px;
      position: absolute;
      bottom: 40mm;
      text-align: center;
      width: 100%;
      right: 0;
    }
    
    /* Page Header */
    .page-header {
      background: #18181b;
      padding: 15px 20px;
      margin: -20mm -20mm 20px -20mm;
      border-bottom: 1px solid #27272a;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header-left { text-align: right; }
    .header-right { text-align: left; }
    .header-brand {
      color: #10b981;
      font-size: 12px;
      font-weight: 700;
    }
    .header-title {
      color: #e4e4e7;
      font-size: 16px;
      font-weight: 700;
      margin-top: 5px;
    }
    .header-period {
      color: #a1a1aa;
      font-size: 11px;
    }
    
    /* Section Title */
    .section-title {
      color: #e4e4e7;
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 20px;
      border-bottom: 2px solid #3b82f6;
      padding-bottom: 10px;
    }
    
    /* Summary Cards */
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 15px;
      margin-bottom: 30px;
    }
    .summary-card {
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .summary-label {
      color: #a1a1aa;
      font-size: 14px;
    }
    .summary-value {
      font-size: 18px;
      font-weight: 700;
    }
    .value-incoming { color: #10b981; }
    .value-outgoing { color: #f43f5e; }
    .value-net { color: #3b82f6; }
    
    /* Single Item Page Styles */
    .single-item-page {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 200mm;
      text-align: center;
    }
    .item-icon {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 60px;
      font-weight: 700;
      margin-bottom: 40px;
    }
    .revenue-icon {
      background: #10b98120;
      color: #10b981;
      border: 3px solid #10b981;
    }
    .expenses-icon {
      background: #f43f5e20;
      color: #f43f5e;
      border: 3px solid #f43f5e;
    }
    .profit-icon {
      background: #3b82f620;
      color: #3b82f6;
      border: 3px solid #3b82f6;
    }
    .item-label {
      font-size: 28px;
      font-weight: 700;
      color: #e4e4e7;
      margin-bottom: 10px;
    }
    .item-english {
      font-size: 16px;
      color: #a1a1aa;
      margin-bottom: 40px;
    }
    .item-value {
      font-size: 48px;
      font-weight: 700;
    }
    .revenue-value { color: #10b981; }
    .expenses-value { color: #f43f5e; }
    .profit-value { color: #3b82f6; }
    
    /* Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 20px;
    }
    .data-table th {
      background: #10b981;
      color: white;
      padding: 12px;
      text-align: right;
      font-weight: 600;
      font-size: 13px;
    }
    .data-table td {
      background: #18181b;
      padding: 12px;
      border-bottom: 1px solid #27272a;
      font-size: 13px;
    }
    .data-table td:first-child { font-weight: 600; }
    .data-table td:last-child {
      text-align: center;
      font-weight: 700;
      color: #10b981;
    }
    
    /* Total Box */
    .total-box {
      background: #1f2937;
      border: 2px solid #10b981;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin-top: 20px;
    }
    .total-label {
      color: #10b981;
      font-size: 13px;
      margin-bottom: 8px;
    }
    .total-value {
      color: #10b981;
      font-size: 20px;
      font-weight: 700;
    }
    
    /* Verification Text */
    .verification {
      color: #a1a1aa;
      font-size: 11px;
      text-align: center;
      margin-top: 15px;
    }
    
    /* Footer */
    .footer-brand {
      text-align: center;
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #27272a;
    }
    .footer-brand-name {
      color: #10b981;
      font-size: 14px;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <!-- Page 1: Cover -->
  <div class="page cover">
    <div class="logo">CS</div>
    <div class="system-name">Cut Salon System</div>
    <div class="report-title">Monthly Profit Report</div>
    <div class="month-year">${monthName} ${year}</div>
    <div class="generated-info">
      Generated by ${generatedBy}<br>
      ${formatDate(new Date())}
    </div>
  </div>

  <!-- Page 2: Revenue Only -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <div class="header-brand">Cut Salon System</div>
        <div class="header-title">إجمالي الوارد</div>
      </div>
      <div class="header-right">
        <div class="header-period">${monthNameEn} ${year}</div>
      </div>
    </div>

    <div class="single-item-page">
      <div class="item-icon revenue-icon">↑</div>
      <div class="item-label">إجمالي الوارد</div>
      <div class="item-english">Total Revenue</div>
      <div class="item-value revenue-value">${formatCurrency(report.totalRevenue)}</div>
    </div>

    <div class="footer-brand">
      <div class="footer-brand-name">Generated by Hawai POS System</div>
    </div>
  </div>

  <!-- Page 3: Expenses Only -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <div class="header-brand">Cut Salon System</div>
        <div class="header-title">إجمالي المصروف</div>
      </div>
      <div class="header-right">
        <div class="header-period">${monthNameEn} ${year}</div>
      </div>
    </div>

    <div class="single-item-page">
      <div class="item-icon expenses-icon">↓</div>
      <div class="item-label">إجمالي المصروف</div>
      <div class="item-english">Total Expenses</div>
      <div class="item-value expenses-value">${formatCurrency(report.totalExpenses)}</div>
    </div>

    <div class="footer-brand">
      <div class="footer-brand-name">Generated by Hawai POS System</div>
    </div>
  </div>

  <!-- Page 4: Net Profit Only -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <div class="header-brand">Cut Salon System</div>
        <div class="header-title">صافي الربح</div>
      </div>
      <div class="header-right">
        <div class="header-period">${monthNameEn} ${year}</div>
      </div>
    </div>

    <div class="single-item-page">
      <div class="item-icon profit-icon">◆</div>
      <div class="item-label">صافي الربح</div>
      <div class="item-english">Net Profit</div>
      <div class="item-value profit-value">${formatCurrency(report.netProfit)}</div>
    </div>

    <div class="footer-brand">
      <div class="footer-brand-name">Generated by Hawai POS System</div>
    </div>
  </div>

  <!-- Page 3: Partner Distribution -->
  <div class="page">
    <div class="page-header">
      <div class="header-left">
        <div class="header-brand">Cut Salon System</div>
        <div class="header-title">توزيع أرباح الشركاء</div>
      </div>
      <div class="header-right">
        <div class="header-period">${monthNameEn} ${year}</div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>الشريك / Partner</th>
          <th>النسبة / %</th>
          <th>نصيب الربح / Share</th>
        </tr>
      </thead>
      <tbody>
        ${partnerShares.map(partner => `
        <tr>
          <td>${partner.name}</td>
          <td>${partner.percentage.toFixed(4)}%</td>
          <td>${formatCurrency(partner.profitShare)}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="total-box">
      <div class="total-label">إجمالي المبالغ الموزعة للشركاء</div>
      <div class="total-value">${formatCurrency(totalDistributed)}</div>
    </div>

    <div class="verification">
      التحقق: مجموع النسب = ${PARTNERS.reduce((s, p) => s + p.percentage, 0).toFixed(4)}%
    </div>

    <div class="footer-brand">
      <div class="footer-brand-name">Generated by Hawai POS System</div>
    </div>
  </div>
</body>
</html>
  `;

  // Create hidden container
  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  document.body.appendChild(container);

  try {
    await document.fonts.ready;
    
    const canvas = await html2canvas(container, {
      scale: PDF_CONFIG.scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#111114',
      width: 794,
      height: 1123 * 5, // 5 pages
    });

    const imgData = canvas.toDataURL('image/png');
    
    const pdf = new jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
    });

    const imgWidth = PDF_CONFIG.pageWidth;
    const pageHeight = PDF_CONFIG.pageHeight;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    document.body.removeChild(container);
    return pdf.output('blob');
  } catch (error) {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
    throw error;
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
