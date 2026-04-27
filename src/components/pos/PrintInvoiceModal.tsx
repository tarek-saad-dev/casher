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

// ──── CUT SALON Premium Receipt CSS (80mm) — Elegant vintage barber style ────
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
  
  /* Header Section with Ornaments */
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
      #dc2626 4px,
      #dc2626 6px,
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
    background: #f5f5f5;
  }
  
  /* Info Section with Icons */
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
    border-bottom: 1px dotted #ccc;
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
  
  /* Services Table */
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    margin: 2mm 0;
    border: 2px solid #000;
  }
  thead {
    background: #000;
    color: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  th {
    padding: 2mm 1.5mm;
    font-size: 9px;
    font-weight: 900;
    text-align: right;
    border: 1px solid #000;
  }
  th:first-child { text-align: center; width: 8mm; }
  th:last-child { text-align: left; width: 18mm; }
  td {
    padding: 2mm 1.5mm;
    font-size: 9px;
    border: 1px solid #000;
    vertical-align: top;
  }
  td:first-child { text-align: center; font-weight: 700; }
  td:last-child { text-align: left; font-weight: 700; font-family: 'Courier New', monospace; }
  tbody tr:nth-child(even) { background: #f9f9f9; }
  .service-name { font-weight: 700; margin-bottom: 0.5mm; font-size: 10px; }
  .barber-name { font-size: 8px; font-weight: 600; color: #333; }
  
  /* Totals Section */
  .receipt-totals {
    margin: 2mm 0;
    padding: 2mm;
    border: 2px solid #000;
    border-radius: 4px;
  }
  .total-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 1mm;
    font-size: 10px;
  }
  .total-row.subtotal { font-weight: 600; }
  .total-row.discount { font-weight: 700; color: #dc2626; }
  .total-row.grand {
    font-size: 16px;
    font-weight: 900;
    margin-top: 2mm;
    padding-top: 2mm;
    border-top: 2px double #000;
  }
  .total-amount {
    font-family: 'Courier New', monospace;
    font-weight: 900;
  }
  
  /* Gift Promotion Section */
  .gift-section {
    margin: 3mm 0;
    padding: 3mm 2mm;
    border: 2px solid #000;
    border-radius: 6px;
    background: linear-gradient(135deg, #f5f5f5 0%, #fff 50%, #f5f5f5 100%);
    text-align: center;
    position: relative;
  }
  .gift-section::before,
  .gift-section::after {
    content: '✦';
    position: absolute;
    top: 1mm;
    font-size: 8px;
    color: #000;
  }
  .gift-section::before { left: 2mm; }
  .gift-section::after { right: 2mm; }
  .gift-icon {
    font-size: 16px;
    margin-bottom: 1mm;
  }
  .gift-text {
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 1px;
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
      #dc2626 3px,
      #dc2626 4.5px,
      #000 4.5px,
      #000 6px
    );
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

  // Build receipt HTML with new CUT SALON style
  const buildReceiptHTML = useCallback(() => {
    if (!data) return '';
    const fmtDate = (d: string) => {
      try { return new Date(d).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch { return d; }
    };

    const itemRows = (data.items || []).map((item: PrintItem, i: number) => {
      const serviceName = `<div class="service-name">${item.ProName || ''}</div>`;
      const barberName = item.EmpName ? `<div class="barber-name">${item.EmpName}</div>` : '';
      return `<tr>
        <td>${i + 1}</td>
        <td>${serviceName}${barberName}</td>
        <td>${item.SPrice} ج.م</td>
      </tr>`;
    }).join('');

    const discountRow = data.DisVal > 0
      ? `<div class="total-row discount"><span>الخصم:</span><span>- ${data.DisVal} ج.م</span></div>`
      : '';

    const paymentMethod = data.PayCash > 0 && data.PayVisa > 0 ? 'نقدي + فيزا'
      : data.PayVisa > 0 ? 'فيزا'
      : 'نقدي';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>فاتورة #${data.invID}</title>
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
    <div class="receipt-title">✦ فاتورة مبيعات ✦</div>
    
    <!-- Invoice Info -->
    <div class="receipt-info">
      <div class="info-row">
        <span class="info-label"><span class="info-icon">📄</span> رقم الفاتورة:</span>
        <span class="info-value">#${data.invID}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">📅</span> التاريخ:</span>
        <span class="info-value">${fmtDate(data.invDate)}</span>
      </div>
      <div class="info-row">
        <span class="info-label"><span class="info-icon">🕐</span> الوقت:</span>
        <span class="info-value">${data.invTime}</span>
      </div>
      ${data.customerName ? `<div class="info-row">
        <span class="info-label"><span class="info-icon">👤</span> العميل:</span>
        <span class="info-value">${data.customerName}</span>
      </div>` : ''}
      ${data.customerPhone ? `<div class="info-row">
        <span class="info-label"><span class="info-icon">📞</span> الهاتف:</span>
        <span class="info-value">${data.customerPhone}</span>
      </div>` : ''}
      <div class="info-row">
        <span class="info-label"><span class="info-icon">💳</span> طريقة الدفع:</span>
        <span class="info-value">${paymentMethod}</span>
      </div>
    </div>
    
    <!-- Divider -->
    <div class="divider-ornate">
      <div class="divider-line"></div>
      <span class="divider-diamond">✂</span>
      <div class="divider-line"></div>
    </div>
    
    <!-- Services Table -->
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>الخدمة / الحلاق</th>
          <th>السعر</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    
    <!-- Totals -->
    <div class="receipt-totals">
      <div class="total-row subtotal">
        <span>المجموع الفرعي:</span>
        <span class="total-amount">${data.SubTotal} ج.م</span>
      </div>
      ${discountRow}
      <div class="total-row grand">
        <span>الإجمالي:</span>
        <span class="total-amount">${data.GrandTotal} ج.م</span>
      </div>
    </div>
    
    <!-- Gift Promotion -->
    <div class="gift-section">
      <div class="gift-icon">🎁</div>
      <div class="gift-text">اسأل على هديتك</div>
    </div>
    
    <!-- Footer -->
    <div class="receipt-footer">
      <div class="thank-you-row">
        <span class="star-icon">★</span>
        <span class="thank-you">شكراً لزيارتكم</span>
        <span class="star-icon">★</span>
      </div>
      <div class="footer-tagline">نسعد بخدمتكم دائماً</div>
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
            <div className="text-sm border-2 border-black rounded-lg p-2 bg-white text-black max-w-[260px] mx-auto" dir="rtl" style={{ fontFamily: 'Cairo, sans-serif' }}>
              {/* Frame */}
              <div className="border-2 border-black rounded-lg p-2 relative">
                {/* Header with Ornaments */}
                <div className="text-center pb-3 mb-3">
                  <div className="flex justify-center items-center gap-2 mb-3">
                    {/* Barber Pole */}
                    <div className="w-4 h-8 border-2 border-black rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #fff, #fff 2px, #000 2px, #000 4px, #dc2626 4px, #dc2626 6px, #000 6px, #000 8px)' }}></div>
                    
                    {/* Logo */}
                    <div className="w-20 h-20 border-[3px] border-black rounded-full flex flex-col items-center justify-center bg-white">
                      <span className="text-lg">👑</span>
                      <span className="font-black text-xl tracking-wider">CUT</span>
                      <span className="text-lg">〰</span>
                      <span className="text-xs">✂</span>
                    </div>
                    
                    {/* Barber Pole */}
                    <div className="w-4 h-8 border-2 border-black rounded-full" style={{ background: 'repeating-linear-gradient(45deg, #fff, #fff 2px, #000 2px, #000 4px, #dc2626 4px, #dc2626 6px, #000 6px, #000 8px)' }}></div>
                  </div>
                  <p className="font-black text-2xl tracking-widest mb-1">CUT SALON</p>
                  <p className="font-bold text-base mb-1">صالون كت للرجال</p>
                  <p className="font-bold text-sm">📞 01012126899</p>
                </div>
                
                {/* Divider with Diamonds */}
                <div className="flex items-center justify-center gap-2 my-3">
                  <div className="flex-1 h-px bg-black"></div>
                  <span className="text-xs">◆</span>
                  <div className="flex-1 h-px bg-black"></div>
                </div>
              
              {/* Receipt Title */}
              <div className="text-center font-black text-xs my-2 py-1 border-y border-black bg-gray-100">
                ✦ فاتورة مبيعات ✦
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
                    <span className="font-semibold truncate max-w-[120px]">{data.customerName}</span>
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
              
              {/* Divider */}
              <div className="flex items-center justify-center gap-2 my-2">
                <div className="flex-1 h-px bg-black"></div>
                <span className="text-xs">✂</span>
                <div className="flex-1 h-px bg-black"></div>
              </div>
              
              {/* Totals Box */}
              <div className="border-2 border-black rounded p-2 mb-2 text-[11px]">
                <div className="flex justify-between font-semibold mb-1">
                  <span>المجموع الفرعي:</span>
                  <span className="font-mono">{data.SubTotal} ج.م</span>
                </div>
                {data.DisVal > 0 && (
                  <div className="flex justify-between font-bold text-red-600 mb-1">
                    <span>الخصم:</span>
                    <span className="font-mono">- {data.DisVal} ج.م</span>
                  </div>
                )}
                <div className="flex justify-between font-black text-base border-t-2 border-double border-black pt-2 mt-2">
                  <span>الإجمالي:</span>
                  <span className="font-mono">{data.GrandTotal} ج.م</span>
                </div>
              </div>
              
              {/* Gift Promotion Section */}
              <div className="border-2 border-black rounded-md p-3 my-3 text-center relative bg-gradient-to-r from-gray-100 via-white to-gray-100">
                <span className="absolute top-1 left-2 text-[10px]">✦</span>
                <span className="absolute top-1 right-2 text-[10px]">✦</span>
                <div className="text-2xl mb-1">🎁</div>
                <div className="font-black text-base tracking-wide">اسأل على هديتك</div>
              </div>
              
              {/* Footer */}
              <div className="text-center mt-3 pt-2 border-t border-black">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <span className="text-[10px]">★</span>
                  <span className="font-black text-sm">شكراً لزيارتكم</span>
                  <span className="text-[10px]">★</span>
                </div>
                <p className="text-[10px] font-semibold">نسعد بخدمتكم دائماً</p>
                <p className="text-[9px] font-bold mt-1 pt-1 border-t border-black">📞 01012126899 - 035861483</p>
              </div>
              
              {/* Bottom Barber Pole */}
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

        {!loading && !data && (
          <p className="text-center py-8 text-destructive">خطأ في تحميل بيانات الفاتورة</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
