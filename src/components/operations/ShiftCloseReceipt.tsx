'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PaymentBreakdown {
  method: string;
  cnt: number;
  total: number;
}

interface ShiftCloseData {
  shiftMoveID: number;
  userName: string;
  shiftName: string;
  startTime: string;
  endTime?: string;
  salesCount: number;
  totalRevenue: number;
  paymentBreakdown: PaymentBreakdown[];
  cashIn: number;
  cashOut: number;
  notes?: string;
}

interface ShiftCloseReceiptProps {
  open: boolean;
  data: ShiftCloseData | null;
  onClose: () => void;
}

// ──── CUT SALON Shift Close Receipt CSS ────
const THERMAL_CSS = `
  @page {
    size: 72mm auto;
    margin: 0mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 72mm;
    max-width: 72mm;
    overflow: hidden;
    font-family: 'Cairo', sans-serif;
    direction: rtl;
    font-size: 10px;
    line-height: 1.3;
    color: #000;
    background: #fff;
    padding: 4mm 4mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  
  /* Ornate Border Frame */
  .receipt-frame {
    border: 2px solid #000;
    border-radius: 8px;
    padding: 3mm;
    position: relative;
  }
  .receipt-frame::before {
    content: '';
    position: absolute;
    top: 1mm;
    left: 1mm;
    right: 1mm;
    bottom: 1mm;
    border: 1px solid #000;
    border-radius: 6px;
    pointer-events: none;
  }
  
  /* Header Section */
  .receipt-header {
    text-align: center;
    padding-bottom: 2mm;
    margin-bottom: 2mm;
    position: relative;
  }
  
  /* Barber Poles */
  .header-ornaments {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 3mm;
    margin-bottom: 2mm;
  }
  .barber-pole {
    width: 6mm;
    height: 12mm;
    border: 1.5px solid #000;
    border-radius: 3mm;
    background: repeating-linear-gradient(
      45deg,
      #fff,
      #fff 2px,
      #000 2px,
      #000 4px,
      #666 4px,
      #666 6px,
      #000 6px,
      #000 8px
    );
  }
  
  /* Crown Logo */
  .logo-circle {
    width: 22mm;
    height: 22mm;
    margin: 0 auto;
    border: 3px solid #000;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #fff;
    position: relative;
  }
  .crown {
    font-size: 10px;
    margin-bottom: 1mm;
  }
  .logo-text {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 1px;
  }
  .mustache {
    font-size: 10px;
    margin-top: 1mm;
  }
  .scissors {
    font-size: 8px;
    margin-top: 0.5mm;
  }
  
  /* Salon Name */
  .salon-name-main {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: 2px;
    margin-top: 2mm;
    margin-bottom: 1mm;
  }
  .salon-name-ar {
    font-size: 13px;
    font-weight: 700;
    margin-bottom: 1mm;
  }
  .salon-phone {
    font-size: 11px;
    font-weight: 700;
    margin-bottom: 2mm;
  }
  
  /* Divider with Diamonds */
  .divider-ornate {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    margin: 2mm 0;
    font-size: 8px;
  }
  .divider-line {
    flex: 1;
    height: 1px;
    background: #000;
  }
  .divider-diamond {
    color: #000;
    font-size: 6px;
  }
  
  /* Receipt Title */
  .receipt-title {
    font-size: 12px;
    font-weight: 900;
    margin: 2mm 0;
    padding: 1mm 3mm;
    border-top: 1px solid #000;
    border-bottom: 1px solid #000;
    background: #fff;
  }
  
  /* Info Section */
  .receipt-info {
    margin-bottom: 2mm;
    font-size: 10px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5mm;
    padding: 1mm 0;
    border-bottom: 1px dotted #000;
  }
  .info-row:last-child { border-bottom: none; }
  .info-label {
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 1mm;
  }
  .info-icon {
    font-size: 10px;
  }
  .info-value {
    font-weight: 600;
    font-family: 'Courier New', monospace;
  }
  
  /* Summary Box */
  .summary-box {
    margin: 2mm 0;
    padding: 2mm;
    border: 2px solid #000;
    border-radius: 4px;
    background: #f9f9f9;
  }
  .summary-title {
    font-size: 11px;
    font-weight: 900;
    text-align: center;
    margin-bottom: 2mm;
    padding-bottom: 1mm;
    border-bottom: 1px solid #000;
  }
  .summary-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1mm;
    font-size: 10px;
  }
  .summary-row.total {
    font-size: 12px;
    font-weight: 900;
    margin-top: 2mm;
    padding-top: 2mm;
    border-top: 2px double #000;
  }
  .summary-amount {
    font-family: 'Courier New', monospace;
    font-weight: 900;
  }
  
  /* Payment Table */
  .payment-table {
    width: 100%;
    border-collapse: collapse;
    margin: 2mm 0;
    border: 2px solid #000;
  }
  .payment-table th {
    padding: 2mm 1.5mm;
    font-size: 9px;
    font-weight: 900;
    text-align: right;
    border: 1px solid #000;
    background: #000;
    color: #fff;
  }
  .payment-table td {
    padding: 1.5mm 1.5mm;
    font-size: 9px;
    border: 1px solid #000;
    vertical-align: top;
  }
  .payment-table td:first-child { text-align: center; }
  .payment-table td:last-child { text-align: left; font-weight: 700; font-family: 'Courier New', monospace; }
  
  /* Cash Movement */
  .cash-box {
    margin: 2mm 0;
    padding: 2mm;
    border: 2px solid #000;
    border-radius: 4px;
  }
  .cash-title {
    font-size: 11px;
    font-weight: 900;
    text-align: center;
    margin-bottom: 2mm;
  }
  .cash-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1mm;
    font-size: 10px;
  }
  .cash-row.in { color: #16a34a; }
  .cash-row.out { color: #dc2626; }
  .cash-row.net {
    font-size: 12px;
    font-weight: 900;
    margin-top: 2mm;
    padding-top: 2mm;
    border-top: 2px double #000;
  }
  
  /* Footer */
  .receipt-footer {
    text-align: center;
    margin-top: 3mm;
    padding-top: 2mm;
    font-size: 10px;
  }
  .thank-you-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    margin-bottom: 1mm;
  }
  .thank-you {
    font-size: 11px;
    font-weight: 700;
  }
  .star-icon {
    font-size: 8px;
  }
  .footer-tagline {
    font-size: 9px;
    font-weight: 600;
    margin-bottom: 1mm;
  }
  .footer-contact {
    font-size: 9px;
    font-weight: 700;
    margin-top: 1mm;
    padding-top: 1mm;
    border-top: 1px solid #000;
  }
  
  /* Bottom Barber Pole */
  .footer-ornament {
    display: flex;
    justify-content: center;
    margin-top: 2mm;
  }
  .barber-pole-small {
    width: 5mm;
    height: 10mm;
    border: 1.5px solid #000;
    border-radius: 2.5mm;
    background: repeating-linear-gradient(
      45deg,
      #fff,
      #fff 1.5px,
      #000 1.5px,
      #000 3px,
      #666 3px,
      #666 4.5px,
      #000 4.5px,
      #000 6px
    );
  }
`;

export default function ShiftCloseReceipt({ open, data, onClose }: ShiftCloseReceiptProps) {
  const [printing, setPrinting] = useState(false);
  const printWindowRef = useRef<Window | null>(null);

  const buildReceiptHTML = useCallback(() => {
    if (!data) return '';

    const fmtDate = () => {
      try { return new Date().toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
      catch { return ''; }
    };
    const fmtTime = () => {
      try { return new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }); }
      catch { return ''; }
    };
    const fmt = (n: number) => n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const paymentRows = (data.paymentBreakdown || []).map((p, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${p.method}</td>
        <td>${p.cnt}</td>
        <td>${fmt(p.total)} ج.م</td>
      </tr>
    `).join('');

    const cashNet = data.cashIn - data.cashOut;

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>ملخص وردية #${data.shiftMoveID}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>${THERMAL_CSS}</style>
</head>
<body>
  <div class="receipt-frame">
    <!-- Header with Ornaments -->
    <div class="receipt-header">
      <div class="header-ornaments">
        <div class="barber-pole"></div>
        <div class="logo-circle">
          <div class="crown">👑</div>
          <div class="logo-text">CUT</div>
          <div class="mustache">〰</div>
          <div class="scissors">✂</div>
        </div>
        <div class="barber-pole"></div>
      </div>
      <div class="salon-name-main">CUT SALON</div>
      <div class="salon-name-ar">صالون كت للرجال</div>
      <div class="salon-phone">📞 01012126899</div>
    </div>
    
    <!-- Divider -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">◆</span>
      <div class="divider-line"></div>
    </div>
    
    <!-- Receipt Title -->
    <div class="receipt-title">✦ ملخص إغلاق الوردية ✦</div>
    
    <!-- Shift Info -->
    <div class="receipt-info">
      <div class="info-row">
        <span class="info-label"><span class="info-icon">🆔</span> رقم الوردية:</span>
        <span class="info-value">#${data.shiftMoveID}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">👤</span> الموظف:</span>
        <span class="info-value">${data.userName}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">⏰</span> الوردية:</span>
        <span class="info-value">${data.shiftName}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">🕐</span> وقت البدء:</span>
        <span class="info-value">${data.startTime}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">🕐</span> وقت الإغلاق:</span>
        <span class="info-value">${fmtTime()}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">📅</span> التاريخ:</span>
        <span class="info-value">${fmtDate()}</span>
      </div>
    </div>
    
    <!-- Divider -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">✂</span>
      <div class="divider-line"></div>
    </div>
    
    <!-- Sales Summary -->
    <div class="summary-box">
      <div class="summary-title">📊 ملخص المبيعات</div>
      <div class="summary-row">
        <span>عدد الفواتير:</span>
        <span class="summary-amount">${data.salesCount} فاتورة</span>
      </div>
      <div class="summary-row total">
        <span>إجمالي المبيعات:</span>
        <span class="summary-amount">${fmt(data.totalRevenue)} ج.م</span>
      </div>
    </div>
    
    <!-- Payment Breakdown -->
    ${data.paymentBreakdown?.length > 0 ? `
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">💳</span>
      <div class="divider-line"></div>
    </div>
    
    <div class="summary-title">💳 تفصيل طرق الدفع</div>
    <table class="payment-table">
      <thead>
        <tr>
          <th>#</th>
          <th>طريقة الدفع</th>
          <th>العدد</th>
          <th>المبلغ</th>
        </tr>
      </thead>
      <tbody>
        ${paymentRows}
      </tbody>
    </table>
    ` : ''}
    
    <!-- Cash Movement -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">💵</span>
      <div class="divider-line"></div>
    </div>
    
    <div class="cash-box">
      <div class="cash-title">💵 حركة النقدية</div>
      <div class="cash-row in">
        <span>وارد نقدي:</span>
        <span class="summary-amount">+${fmt(data.cashIn)} ج.م</span>
      </div>
      <div class="cash-row out">
        <span>صادر نقدي:</span>
        <span class="summary-amount">-${fmt(data.cashOut)} ج.م</span>
      </div>
      <div class="cash-row net">
        <span>صافي النقدية:</span>
        <span class="summary-amount">${cashNet >= 0 ? '+' : ''}${fmt(cashNet)} ج.م</span>
      </div>
    </div>
    
    ${data.notes ? `
    <!-- Notes -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">📝</span>
      <div class="divider-line"></div>
    </div>
    <div class="info-row">
      <span class="info-label">📝 ملاحظات:</span>
      <span class="info-value">${data.notes}</span>
    </div>
    ` : ''}
    
    <!-- Footer -->
    <div class="receipt-footer">
      <div class="thank-you-row">
        <span class="star-icon">★</span>
        <span class="thank-you">شكراً لجهودكم</span>
        <span class="star-icon">★</span>
      </div>
      <div class="footer-tagline">تم إغلاق الوردية بنجاح</div>
      <div class="footer-contact">📞 01012126899 - 035861483</div>
    </div>
    
    <!-- Bottom Ornament -->
    <div class="footer-ornament">
      <div class="barber-pole-small"></div>
    </div>
  </div>
</body>
</html>`;
  }, [data]);

  const handlePrint = useCallback(() => {
    if (printing || !data) return;
    setPrinting(true);

    if (printWindowRef.current && !printWindowRef.current.closed) {
      printWindowRef.current.close();
    }

    const win = window.open('', '_blank', 'width=350,height=600');
    if (!win) {
      setPrinting(false);
      return;
    }
    printWindowRef.current = win;

    const html = buildReceiptHTML();
    win.document.write(html);
    win.document.close();

    win.onload = () => {
      win.onafterprint = () => {
        win.close();
        printWindowRef.current = null;
        setPrinting(false);
      };

      win.print();

      setTimeout(() => {
        if (printWindowRef.current && !printWindowRef.current.closed) {
          printWindowRef.current.close();
          printWindowRef.current = null;
        }
        setPrinting(false);
      }, 10000);
    };
  }, [printing, data, buildReceiptHTML]);

  useEffect(() => {
    return () => {
      if (printWindowRef.current && !printWindowRef.current.closed) {
        printWindowRef.current.close();
      }
    };
  }, []);

  const fmt = (n: number) => n?.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00';
  const cashNet = data ? data.cashIn - data.cashOut : 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5" />
            طباعة ملخص الوردية
          </DialogTitle>
        </DialogHeader>

        {!data && <p className="text-center py-8 text-muted-foreground">لا توجد بيانات</p>}

        {data && (
          <>
            {/* Receipt Preview */}
            <div className="text-sm border-2 border-black rounded-lg p-2 bg-white text-black max-w-[260px] mx-auto font-sans" dir="rtl">
              <div className="border-2 border-black rounded-lg p-2 relative">
                {/* Header */}
                <div className="text-center pb-3 mb-3">
                  <div className="flex justify-center items-center gap-2 mb-3">
                    <div className="w-4 h-8 border-2 border-black rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #fff, #fff 2px, #000 2px, #000 4px, #dc2626 4px, #dc2626 6px, #000 6px, #000 8px)' }}></div>
                    <div className="w-20 h-20 border-[3px] border-black rounded-full flex flex-col items-center justify-center bg-white">
                      <span className="text-lg">👑</span>
                      <span className="font-black text-xl tracking-wider">CUT</span>
                      <span className="text-lg">〰</span>
                      <span className="text-xs">✂</span>
                    </div>
                    <div className="w-4 h-8 border-2 border-black rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #fff, #fff 2px, #000 2px, #000 4px, #dc2626 4px, #dc2626 6px, #000 6px, #000 8px)' }}></div>
                  </div>
                  <p className="font-black text-2xl tracking-widest mb-1">CUT SALON</p>
                  <p className="font-bold text-base mb-1">صالون كت للرجال</p>
                  <p className="font-bold text-sm">📞 01012126899</p>
                </div>

                {/* Title */}
                <div className="text-center font-black text-xs my-2 py-1 border-y border-black bg-gray-100">
                  ✦ ملخص إغلاق الوردية ✦
                </div>

                {/* Info */}
                <div className="text-[10px] font-semibold space-y-1 mb-2">
                  <div className="flex justify-between"><span className="font-bold">رقم الوردية:</span><span>#{data.shiftMoveID}</span></div>
                  <div className="flex justify-between"><span className="font-bold">الموظف:</span><span>{data.userName}</span></div>
                  <div className="flex justify-between"><span className="font-bold">الوردية:</span><span>{data.shiftName}</span></div>
                  <div className="flex justify-between"><span className="font-bold">بدأت:</span><span>{data.startTime}</span></div>
                </div>

                <div className="border-t-2 border-dashed border-black my-2" />

                {/* Sales Summary */}
                <div className="border-2 border-black rounded p-2 mb-2 bg-gray-50">
                  <div className="font-black text-xs text-center mb-2 border-b border-black pb-1">📊 ملخص المبيعات</div>
                  <div className="flex justify-between text-[10px] mb-1">
                    <span>عدد الفواتير:</span>
                    <span className="font-bold">{data.salesCount} فاتورة</span>
                  </div>
                  <div className="flex justify-between text-xs font-black border-t border-black pt-1 mt-1">
                    <span>إجمالي المبيعات:</span>
                    <span>{fmt(data.totalRevenue)} ج.م</span>
                  </div>
                </div>

                {/* Cash Movement */}
                <div className="border-2 border-black rounded p-2 mb-2">
                  <div className="font-black text-xs text-center mb-2">💵 حركة النقدية</div>
                  <div className="flex justify-between text-[10px] text-emerald-600 mb-1">
                    <span>وارد:</span><span>+{fmt(data.cashIn)} ج.م</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-rose-600 mb-1">
                    <span>صادر:</span><span>-{fmt(data.cashOut)} ج.م</span>
                  </div>
                  <div className="flex justify-between text-xs font-black border-t-2 border-double border-black pt-1 mt-1">
                    <span>صافي:</span>
                    <span>{cashNet >= 0 ? '+' : ''}{fmt(cashNet)} ج.م</span>
                  </div>
                </div>

                {/* Footer */}
                <div className="text-center mt-3 pt-2 border-t border-black">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <span className="text-[10px]">★</span>
                    <span className="font-black text-sm">تم إغلاق الوردية بنجاح</span>
                    <span className="text-[10px]">★</span>
                  </div>
                </div>

                <div className="flex justify-center mt-2">
                  <div className="w-4 h-6 border-2 border-black rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #fff, #fff 1.5px, #000 1.5px, #000 3px, #dc2626 3px, #dc2626 4.5px, #000 4.5px, #000 6px)' }} />
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 justify-end mt-3">
              <Button variant="outline" onClick={onClose}>
                <X className="w-4 h-4 ml-2" />
                إغلاق
              </Button>
              <Button onClick={handlePrint} disabled={printing}>
                <Printer className="w-4 h-4 ml-2" />
                {printing ? 'جاري الطباعة...' : 'طباعة'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
