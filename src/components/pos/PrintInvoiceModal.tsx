'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PrintItem {
  ProName: string;
  EmpName: string;
  SPrice: number;
  Qty: number;
  SPriceAfterDis: number;
}

interface PrintData {
  invID: number;
  invDate: string;
  invTime: string;
  customerName: string;
  customerPhone: string | null;
  SubTotal: number;
  Dis: number;
  DisVal: number;
  GrandTotal: number;
  PayCash: number;
  PayVisa: number;
  PaymentMethodID: number | null;
  TotalBonus: number;
  items: PrintItem[];
}

interface PrintInvoiceModalProps {
  open: boolean;
  invID: number | null;
  onClose: () => void;
}

// ──── Premium Thermal Receipt CSS (72mm) — Optimized for weak print density ────
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
    font-family: 'Arial', 'Segoe UI', sans-serif;
    direction: rtl;
    font-size: 11px;
    line-height: 1.4;
    color: #000;
    background: #fff;
    padding: 3mm 3mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  
  /* Header Section */
  .receipt-header {
    text-align: center;
    padding-bottom: 3mm;
    border-bottom: 2px solid #000;
    margin-bottom: 3mm;
  }
  .logo {
    width: 20mm;
    height: 20mm;
    margin: 0 auto 2mm;
    border: 2px solid #000;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 900;
    background: #000;
    color: #fff;
  }
  .salon-name {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: 1px;
    margin-bottom: 1mm;
  }
  .salon-name-ar {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 1mm;
  }
  .salon-phone {
    font-size: 11px;
    font-weight: 700;
  }
  .receipt-title {
    font-size: 13px;
    font-weight: 900;
    margin-top: 2mm;
    text-transform: uppercase;
  }
  
  /* Info Section */
  .receipt-info {
    margin-bottom: 2mm;
    font-size: 10px;
    font-weight: 600;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1mm;
    line-height: 1.3;
  }
  .info-row .label { font-weight: 700; }
  .info-row .value { font-weight: 600; }
  
  .divider {
    border-top: 2px dashed #000;
    margin: 2mm 0;
  }
  .divider-thin {
    border-top: 1px dashed #000;
    margin: 1.5mm 0;
  }
  
  /* Table */
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin-bottom: 2mm;
  }
  thead {
    background: #000;
    color: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  th {
    padding: 1.5mm 1mm;
    font-size: 10px;
    font-weight: 900;
    text-align: right;
    border: none;
  }
  td {
    padding: 1.5mm 1mm;
    font-size: 10px;
    font-weight: 600;
    border-bottom: 1px solid #000;
    vertical-align: top;
  }
  tbody tr:last-child td { border-bottom: 2px solid #000; }
  .col-num { width: 8mm; text-align: center; font-weight: 700; }
  .col-desc { width: auto; }
  .col-price { width: 16mm; text-align: left; font-weight: 700; }
  .service-name { font-weight: 700; margin-bottom: 0.5mm; }
  .barber-name { font-size: 9px; font-weight: 600; }
  
  /* Totals Section */
  .receipt-totals {
    border-top: 2px solid #000;
    padding-top: 2mm;
    font-size: 11px;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1mm;
    font-weight: 700;
  }
  .total-row.subtotal { font-size: 11px; }
  .total-row.discount { font-size: 11px; font-weight: 900; }
  .total-row.grand {
    font-size: 16px;
    font-weight: 900;
    margin-top: 2mm;
    padding-top: 2mm;
    border-top: 3px double #000;
  }
  .total-row.payment {
    font-size: 10px;
    font-weight: 700;
    margin-top: 1mm;
  }
  
  /* Footer */
  .receipt-footer {
    text-align: center;
    margin-top: 3mm;
    padding-top: 2mm;
    border-top: 2px solid #000;
    font-size: 10px;
    font-weight: 700;
  }
  .thank-you {
    font-size: 12px;
    font-weight: 900;
    margin-bottom: 1mm;
  }
  .contact-info {
    font-size: 9px;
    font-weight: 600;
    margin-top: 1mm;
  }
`;

export default function PrintInvoiceModal({ open, invID, onClose }: PrintInvoiceModalProps) {
  const [data, setData] = useState<PrintData | null>(null);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printWindowRef = useRef<Window | null>(null);

  // Fetch invoice data when modal opens
  useEffect(() => {
    if (!open || !invID) { setData(null); return; }
    setLoading(true);
    setPrinting(false);
    fetch(`/api/sales/${invID}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, invID]);

  // Build receipt HTML (no buttons, no JS in output)
  const buildReceiptHTML = useCallback(() => {
    if (!data) return '';
    const fmtDate = (d: string) => {
      try { return new Date(d).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return d; }
    };

    const itemRows = (data.items || []).map((item: PrintItem, i: number) => {
      const serviceName = `<div class="service-name">${item.ProName || ''}</div>`;
      const barberName = item.EmpName ? `<div class="barber-name">${item.EmpName}</div>` : '';
      return `<tr>
        <td class="col-num">${i + 1}</td>
        <td class="col-desc">${serviceName}${barberName}</td>
        <td class="col-price">${item.SPrice} ج.م</td>
      </tr>`;
    }).join('');

    const discountRow = data.DisVal > 0
      ? `<div class="total-row discount"><span>الخصم</span><span>- ${data.DisVal} ج.م</span></div>`
      : '';

    const paymentMethod = data.PayCash > 0 && data.PayVisa > 0 ? 'نقدي + فيزا'
      : data.PayVisa > 0 ? 'فيزا'
      : 'نقدي';

    const paymentDetails = data.PayCash > 0 && data.PayVisa > 0
      ? `<div class="total-row payment"><span>نقدي</span><span>${data.PayCash} ج.م</span></div>
         <div class="total-row payment"><span>فيزا</span><span>${data.PayVisa} ج.م</span></div>`
      : '';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>فاتورة #${data.invID}</title>
  <style>${THERMAL_CSS}</style>
</head>
<body>
  <!-- Header -->
  <div class="receipt-header">
    <div class="logo">CUT</div>
    <div class="salon-name">CUT SALON</div>
    <div class="salon-name-ar">صالون كَت للرجال</div>
    <div class="salon-phone">📞 01012126899</div>
    <div class="receipt-title">فاتورة مبيعات</div>
  </div>
  
  <!-- Invoice Info -->
  <div class="receipt-info">
    <div class="info-row">
      <span class="label">رقم الفاتورة:</span>
      <span class="value">#${data.invID}</span>
    </div>
    <div class="info-row">
      <span class="label">التاريخ:</span>
      <span class="value">${fmtDate(data.invDate)}</span>
    </div>
    <div class="info-row">
      <span class="label">الوقت:</span>
      <span class="value">${data.invTime}</span>
    </div>
    ${data.customerName ? `<div class="info-row">
      <span class="label">العميل:</span>
      <span class="value">${data.customerName}</span>
    </div>` : ''}
    ${data.customerPhone ? `<div class="info-row">
      <span class="label">الهاتف:</span>
      <span class="value">${data.customerPhone}</span>
    </div>` : ''}
    <div class="info-row">
      <span class="label">طريقة الدفع:</span>
      <span class="value">${paymentMethod}</span>
    </div>
  </div>
  
  <div class="divider"></div>
  
  <!-- Services Table -->
  <table>
    <colgroup>
      <col style="width:8mm"/>
      <col/>
      <col style="width:16mm"/>
    </colgroup>
    <thead>
      <tr>
        <th class="col-num">#</th>
        <th class="col-desc">الخدمة / الحلاق</th>
        <th class="col-price">السعر</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>
  
  <!-- Totals -->
  <div class="receipt-totals">
    <div class="total-row subtotal">
      <span>المجموع الفرعي:</span>
      <span>${data.SubTotal} ج.م</span>
    </div>
    ${discountRow}
    <div class="total-row grand">
      <span>الإجمالي:</span>
      <span>${data.GrandTotal} ج.م</span>
    </div>
    ${paymentDetails}
  </div>
  
  <div class="divider"></div>
  
  <!-- Footer -->
  <div class="receipt-footer">
    <div class="thank-you">شكراً لزيارتكم</div>
    <div>نسعد بخدمتكم دائماً</div>
    <div class="contact-info">📞 01012126899 | CUT SALON</div>
  </div>
</body>
</html>`;
  }, [data]);

  // Single guarded print handler
  const handlePrint = useCallback(() => {
    if (printing || !data) return;
    setPrinting(true);

    // Close any leftover window
    if (printWindowRef.current && !printWindowRef.current.closed) {
      printWindowRef.current.close();
    }

    const win = window.open('', '_blank', 'width=350,height=500');
    if (!win) {
      setPrinting(false);
      return;
    }
    printWindowRef.current = win;

    const html = buildReceiptHTML();
    win.document.write(html);
    win.document.close();

    // Wait for content to render, then print ONCE
    win.onload = () => {
      // Guard: only close after print finishes (or is cancelled)
      win.onafterprint = () => {
        win.close();
        printWindowRef.current = null;
        setPrinting(false);
      };

      // Trigger print exactly once
      win.print();

      // Fallback: if onafterprint never fires (some browsers), close after 10s
      setTimeout(() => {
        if (printWindowRef.current && !printWindowRef.current.closed) {
          printWindowRef.current.close();
          printWindowRef.current = null;
        }
        setPrinting(false);
      }, 10000);
    };
  }, [printing, data, buildReceiptHTML]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (printWindowRef.current && !printWindowRef.current.closed) {
        printWindowRef.current.close();
      }
    };
  }, []);

  const fmtDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('ar-EG'); } catch { return d; }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="w-5 h-5" />
            طباعة الفاتورة
          </DialogTitle>
        </DialogHeader>

        {loading && <p className="text-center py-8 text-muted-foreground">جاري التحميل...</p>}

        {!loading && data && (
          <>
            {/* Receipt preview (screen only — matches thermal layout) */}
            <div className="text-sm border-2 border-black rounded-lg p-4 bg-white text-black max-w-[280px] mx-auto" dir="rtl">
              {/* Header */}
              <div className="text-center border-b-2 border-black pb-3 mb-3">
                <div className="w-16 h-16 mx-auto mb-2 border-2 border-black rounded-full flex items-center justify-center bg-black text-white font-black text-lg">
                  CUT
                </div>
                <p className="font-black text-lg tracking-wide">CUT SALON</p>
                <p className="font-bold text-sm mb-1">صالون كَت للرجال</p>
                <p className="font-bold text-[11px]">📞 01000000000</p>
                <p className="font-black text-xs mt-2 uppercase">فاتورة مبيعات</p>
              </div>
              
              {/* Info */}
              <div className="text-[10px] font-semibold space-y-1 mb-2">
                <div className="flex justify-between">
                  <span className="font-bold">رقم الفاتورة:</span>
                  <span className="font-semibold">#{data.invID}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold">التاريخ:</span>
                  <span className="font-semibold">{fmtDate(data.invDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-bold">الوقت:</span>
                  <span className="font-semibold">{data.invTime}</span>
                </div>
                {data.customerName && (
                  <div className="flex justify-between">
                    <span className="font-bold">العميل:</span>
                    <span className="font-semibold truncate max-w-[140px]">{data.customerName}</span>
                  </div>
                )}
                {data.customerPhone && (
                  <div className="flex justify-between">
                    <span className="font-bold">الهاتف:</span>
                    <span className="font-semibold">{data.customerPhone}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="font-bold">طريقة الدفع:</span>
                  <span className="font-semibold">
                    {data.PayCash > 0 && data.PayVisa > 0 ? 'نقدي + فيزا' : data.PayVisa > 0 ? 'فيزا' : 'نقدي'}
                  </span>
                </div>
              </div>
              
              <div className="border-t-2 border-dashed border-black my-2" />
              
              {/* Table */}
              <table className="w-full text-[10px] mb-2 table-fixed">
                <colgroup>
                  <col className="w-8" />
                  <col />
                  <col className="w-16" />
                </colgroup>
                <thead>
                  <tr className="bg-black text-white">
                    <th className="p-1 text-center text-[10px] font-black">#</th>
                    <th className="p-1 text-right text-[10px] font-black">الخدمة / الحلاق</th>
                    <th className="p-1 text-left text-[10px] font-black">السعر</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items?.map((item: PrintItem, i: number) => (
                    <tr key={i} className="border-b border-black">
                      <td className="p-1 text-center font-bold">{i + 1}</td>
                      <td className="p-1 break-words">
                        <div className="font-bold">{item.ProName}</div>
                        {item.EmpName && <div className="text-[9px] font-semibold">{item.EmpName}</div>}
                      </td>
                      <td className="p-1 text-left font-bold">{item.SPrice} ج.م</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {/* Totals */}
              <div className="border-t-2 border-black pt-2 text-[11px] font-bold space-y-1">
                <div className="flex justify-between">
                  <span>المجموع الفرعي:</span>
                  <span>{data.SubTotal} ج.م</span>
                </div>
                {data.DisVal > 0 && (
                  <div className="flex justify-between font-black">
                    <span>الخصم</span>
                    <span>- {data.DisVal} ج.م</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base border-t-[3px] border-double border-black pt-2 mt-2">
                  <span>الإجمالي:</span>
                  <span>{data.GrandTotal} ج.م</span>
                </div>
                {data.PayCash > 0 && data.PayVisa > 0 && (
                  <>
                    <div className="flex justify-between text-[10px] font-bold mt-1">
                      <span>نقدي</span>
                      <span>{data.PayCash} ج.م</span>
                    </div>
                    <div className="flex justify-between text-[10px] font-bold">
                      <span>فيزا</span>
                      <span>{data.PayVisa} ج.م</span>
                    </div>
                  </>
                )}
              </div>
              
              <div className="border-t-2 border-black mt-2" />
              
              {/* Footer */}
              <div className="text-center font-bold mt-2 pt-2">
                <p className="font-black text-xs mb-1">شكراً لزيارتكم</p>
                <p className="text-[10px]">نسعد بخدمتكم دائماً</p>
                <p className="text-[9px] font-semibold mt-1">📞 01000000000 | CUT SALON</p>
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

        {!loading && !data && (
          <p className="text-center py-8 text-destructive">خطأ في تحميل بيانات الفاتورة</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
