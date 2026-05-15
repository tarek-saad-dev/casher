'use client';

import jsPDF from 'jspdf';
import html2canvas from 'html2canvas-pro';

interface CategoryPdfData {
  categoryName: string;
  totalAmount: number;
  count: number;
  transactions: {
    invID: number;
    invDate: string;
    invTime: string;
    GrandTolal: number;
    PaymentMethod: string | null;
    UserName: string | null;
    Notes: string | null;
  }[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('ar-EG', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount) + ' ج.م';
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export async function exportCategoryToPdf(data: CategoryPdfData) {
  // Create a temporary off-screen container to render the HTML
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.width = '800px';
  container.style.direction = 'rtl';
  container.style.fontFamily = 'Cairo, Tahoma, Arial, sans-serif';
  container.style.backgroundColor = '#ffffff';
  container.style.color = '#111111';
  container.style.padding = '32px';

  const rows = data.transactions.map((t, i) => `
    <tr style="border-bottom: 1px solid #e5e5e5; ${i % 2 === 0 ? 'background: #fafafa;' : ''}">
      <td style="padding: 10px 12px; font-size: 13px; text-align: center; color: #666;">${i + 1}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: center;">${t.invID}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: center;">${formatDate(t.invDate)}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: center;">${t.invTime || '—'}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: center; font-weight: 700; color: #dc2626;">${formatCurrency(t.GrandTolal)}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: center;">${t.PaymentMethod || '—'}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: center;">${t.UserName || '—'}</td>
      <td style="padding: 10px 12px; font-size: 13px; text-align: right; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.Notes || '—'}</td>
    </tr>
  `).join('');

  container.innerHTML = `
    <div style="margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #D6A84F;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div>
          <h1 style="font-size: 22px; font-weight: 800; margin: 0 0 4px 0; color: #111;">تقرير مصروفات: ${data.categoryName}</h1>
          <p style="font-size: 13px; color: #888; margin: 0;">${data.count} معاملة — الإجمالي: <span style="font-weight: 700; color: #dc2626;">${formatCurrency(data.totalAmount)}</span></p>
        </div>
        <div style="text-align: left;">
          <p style="font-size: 12px; color: #aaa; margin: 0;">Cut Salon</p>
          <p style="font-size: 11px; color: #ccc; margin: 0;">${new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
    </div>

    <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e5e5; border-radius: 8px; overflow: hidden;">
      <thead>
        <tr style="background: #1a1a2e; color: #ffffff;">
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">#</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">رقم الفاتورة</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">التاريخ</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">الوقت</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">المبلغ</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">طريقة الدفع</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: center;">المستخدم</th>
          <th style="padding: 10px 12px; font-size: 12px; font-weight: 600; text-align: right;">الملاحظات</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
      <tfoot>
        <tr style="background: #f5f0e0; border-top: 2px solid #D6A84F;">
          <td colspan="4" style="padding: 12px; font-size: 14px; font-weight: 800; text-align: center; color: #111;">الإجمالي</td>
          <td style="padding: 12px; font-size: 14px; font-weight: 800; text-align: center; color: #dc2626;">${formatCurrency(data.totalAmount)}</td>
          <td colspan="3" style="padding: 12px;"></td>
        </tr>
      </tfoot>
    </table>

    <div style="margin-top: 20px; text-align: center;">
      <p style="font-size: 11px; color: #bbb;">تم التصدير من نظام نقاط البيع — Cut Salon</p>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    const imgData = canvas.toDataURL('image/png');
    const imgWidth = 210; // A4 width in mm
    const pageHeight = 297; // A4 height in mm
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const pdf = new jsPDF('p', 'mm', 'a4');

    let heightLeft = imgHeight;
    let position = 0;

    // First page
    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    // Add more pages if needed
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    pdf.save(`مصروفات_${data.categoryName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    document.body.removeChild(container);
  }
}
