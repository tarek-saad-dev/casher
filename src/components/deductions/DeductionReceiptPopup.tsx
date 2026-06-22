'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Printer, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DeductionReceiptData {
  deductionInvID: number;
  incomeInvID: number;
  invDate: string;
  invTime: string;
  employeeName: string;
  categoryName: string;
  amount: number;
  PaymentMethod: string | null;
  Notes: string | null;
  UserName: string | null;
}

interface DeductionReceiptPopupProps {
  open: boolean;
  deduction: DeductionReceiptData | null;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════
// DEDUCTION RECEIPT CSS — Employee notice style
// ═══════════════════════════════════════════════════════════
const RECEIPT_CSS = `
  @page {
    size: 58mm auto;
    margin: 0mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 58mm;
    max-width: 58mm;
    overflow: hidden;
    font-family: 'Cairo', sans-serif;
    direction: rtl;
    font-size: 9px;
    line-height: 1.2;
    color: #000;
    background: #fff;
    padding: 2mm 3mm;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  
  .deduction-header {
    text-align: center;
    padding-bottom: 1.5mm;
    margin-bottom: 1.5mm;
    border-bottom: 2px solid #000;
  }
  .salon-name {
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 1px;
    margin-bottom: 0.5mm;
  }
  .deduction-title {
    font-size: 14px;
    font-weight: 900;
    background: #000;
    color: #fff;
    padding: 2mm 3mm;
    display: inline-block;
    margin: 1mm 0;
    letter-spacing: 2px;
  }
  
  .employee-notice {
    background: #ff0000;
    color: #fff;
    padding: 2mm;
    text-align: center;
    margin: 2mm 0;
    border: 2px solid #000;
  }
  .notice-text {
    font-size: 10px;
    font-weight: 900;
    margin-bottom: 1mm;
  }
  .employee-name {
    font-size: 12px;
    font-weight: 900;
    text-decoration: underline;
  }
  
  .deduction-info {
    margin: 2mm 0;
    font-size: 9px;
  }
  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1mm;
    padding-bottom: 0.5mm;
  }
  .info-label {
    font-weight: 700;
  }
  .info-value {
    font-weight: 600;
    font-family: 'Courier New', monospace;
  }
  
  .amount-box {
    margin: 2mm 0;
    padding: 2mm;
    border: 2px solid #000;
    text-align: center;
    background: #fff;
  }
  .amount-label {
    font-size: 9px;
    font-weight: 700;
    margin-bottom: 1mm;
  }
  .amount-value {
    font-size: 18px;
    font-weight: 900;
    font-family: 'Courier New', monospace;
    color: #ff0000;
  }
  
  .reason-section {
    margin: 2mm 0;
    padding: 2mm;
    border: 1px solid #000;
    background: #fff5f5;
  }
  .reason-label {
    font-size: 9px;
    font-weight: 700;
    margin-bottom: 1mm;
    text-decoration: underline;
  }
  .reason-text {
    font-size: 8px;
    font-weight: 600;
    word-wrap: break-word;
  }
  
  .divider {
    border-top: 1px dashed #000;
    margin: 2mm 0;
  }
  
  .receipt-footer {
    text-align: center;
    margin-top: 2mm;
    padding-top: 1.5mm;
    border-top: 1px dashed #000;
    font-size: 8px;
  }
  .footer-text {
    font-weight: 700;
  }
  
  .barcode-id {
    font-family: 'Courier New', monospace;
    font-size: 14px;
    font-weight: 900;
    letter-spacing: 2px;
    margin-top: 2mm;
    padding: 1mm;
    border: 1px solid #000;
    display: inline-block;
  }
`;

export default function DeductionReceiptPopup({ open, deduction, onClose }: DeductionReceiptPopupProps) {
  const [printing, setPrinting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const printWindowRef = useRef<Window | null>(null);
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Build receipt HTML
  const buildReceiptHTML = useCallback(() => {
    if (!deduction) return '';
    
    const fmtDate = (d: string) => {
      try { 
        return new Date(d).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: '2-digit' }); 
      } catch { 
        return d; 
      }
    };

    const reasonSection = deduction.Notes 
      ? `<div class="reason-section">
          <div class="reason-label">سبب الخصم:</div>
          <div class="reason-text">${deduction.Notes}</div>
         </div>` 
      : '';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>إشعار خصم - ${deduction.employeeName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>${RECEIPT_CSS}</style>
</head>
<body>
  <div class="deduction-header">
    <div class="salon-name">CUT SALON</div>
    <div class="deduction-title">إشعار خصم</div>
  </div>
  
  <div class="employee-notice">
    <div class="notice-text">تنبيه خصم موظف</div>
    <div class="employee-name">${deduction.employeeName}</div>
  </div>
  
  <div class="deduction-info">
    <div class="info-row">
      <span class="info-label">رقم الخصم:</span>
      <span class="info-value">#${deduction.deductionInvID}</span>
    </div>
    <div class="info-row">
      <span class="info-label">التاريخ:</span>
      <span class="info-value">${fmtDate(deduction.invDate)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">الوقت:</span>
      <span class="info-value">${deduction.invTime}</span>
    </div>
    <div class="info-row">
      <span class="info-label">طريقة الدفع:</span>
      <span class="info-value">${deduction.PaymentMethod || '—'}</span>
    </div>
    ${deduction.UserName ? `<div class="info-row">
      <span class="info-label">المسؤول:</span>
      <span class="info-value">${deduction.UserName}</span>
    </div>` : ''}
  </div>
  
  <div class="amount-box">
    <div class="amount-label">مبلغ الخصم</div>
    <div class="amount-value">${deduction.amount.toLocaleString('ar-EG')} ج.م</div>
  </div>
  
  ${reasonSection}
  
  <div class="divider"></div>
  
  <div class="receipt-footer">
    <div class="footer-text">تم تسجيل الخصم بنجاح</div>
    <div class="footer-text">هذا الإشعار للموظف فقط</div>
    <div class="barcode-id">DED-${String(deduction.deductionInvID).padStart(4, '0')}</div>
  </div>
</body>
</html>`;
  }, [deduction]);

  // Handle visibility and auto-close
  useEffect(() => {
    if (open && deduction) {
      setVisible(true);
      setProgress(100);
      
      // Progress bar animation
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          if (prev <= 0) return 0;
          return prev - 2; // 100 to 0 in ~5 seconds
        });
      }, 100);

      // Auto-close after 5 seconds
      const closeTimer = setTimeout(() => {
        handleClose();
      }, 5000);

      autoCloseTimerRef.current = closeTimer;
      progressTimerRef.current = progressInterval;

      return () => {
        clearTimeout(closeTimer);
        clearInterval(progressInterval);
      };
    }
  }, [open, deduction]);

  const handleClose = () => {
    setVisible(false);
    // Small delay to allow exit animation
    setTimeout(() => {
      onClose();
    }, 300);
  };

  // Print handler
  const handlePrint = useCallback(() => {
    if (printing || !deduction) return;
    setPrinting(true);

    if (printWindowRef.current && !printWindowRef.current.closed) {
      printWindowRef.current.close();
    }

    const win = window.open('', '_blank', 'width=300,height=400');
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
  }, [printing, deduction, buildReceiptHTML]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (printWindowRef.current && !printWindowRef.current.closed) {
        printWindowRef.current.close();
      }
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  if (!deduction || !open) return null;

  return (
    <div
      className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
        visible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
      }`}
    >
      <div className="bg-card border border-border shadow-2xl rounded-lg p-3 min-w-[320px] max-w-[400px]" dir="rtl">
        {/* Progress bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-muted rounded-t-lg overflow-hidden">
          <div
            className="h-full bg-red-600 transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4 text-red-500" />
            </div>
            <div>
              <p className="text-sm font-bold">تم تسجيل الخصم</p>
              <p className="text-xs text-muted-foreground">رقم: #{deduction.deductionInvID}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Receipt Mini Preview */}
        <div className="bg-white border border-black rounded p-2 mb-3 text-black" dir="rtl">
          <div className="text-center border-b-2 border-black pb-1 mb-1">
            <p className="font-black text-[10px] tracking-wider">CUT SALON</p>
            <p className="font-black text-[12px] text-red-600">إشعار خصم</p>
          </div>
          
          <div className="bg-red-600 text-white text-center py-1 mb-1">
            <p className="font-bold text-[9px]">تنبيه خصم موظف</p>
            <p className="font-black text-[10px]">{deduction.employeeName}</p>
          </div>
          
          <div className="text-[9px] space-y-0.5 mb-1">
            <div className="flex justify-between">
              <span className="font-bold">المبلغ:</span>
              <span className="font-black font-mono text-red-600">{deduction.amount.toLocaleString('ar-EG')} ج.م</span>
            </div>
            <div className="flex justify-between">
              <span className="font-bold">التاريخ:</span>
              <span>{new Date(deduction.invDate).toLocaleDateString('ar-EG')}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-bold">الدفع:</span>
              <span>{deduction.PaymentMethod || '—'}</span>
            </div>
          </div>
          
          {deduction.Notes && (
            <div className="border-t border-dashed border-black pt-1 mt-1">
              <p className="text-[8px] font-bold">سبب الخصم:</p>
              <p className="text-[8px] truncate">{deduction.Notes}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-xs"
            onClick={handleClose}
          >
            مسح
          </Button>
          <Button
            size="sm"
            className="flex-1 text-xs gap-1 bg-red-600 hover:bg-red-700"
            onClick={handlePrint}
            disabled={printing}
          >
            <Printer className="w-3 h-3" />
            {printing ? 'جاري...' : 'طباعة'}
          </Button>
        </div>
      </div>
    </div>
  );
}
