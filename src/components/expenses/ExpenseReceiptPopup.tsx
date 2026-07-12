'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { Printer, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  createPrintRequestId,
  openBrowserPrintFallback,
  printHtmlViaLocalService,
  type LocalPrintFailure,
} from '@/lib/localPrintClient';

interface ExpenseReceiptData {
  invID: number;
  invDate: string;
  invTime: string;
  CatName: string;
  GrandTolal: number;
  PaymentMethod: string | null;
  Notes: string | null;
  UserName: string | null;
  ledgerNote?: string | null;
}

interface ExpenseReceiptPopupProps {
  open: boolean;
  expense: ExpenseReceiptData | null;
  onClose: () => void;
}

export type { ExpenseReceiptData };

// ═══════════════════════════════════════════════════════════
// EXPENSE RECEIPT CSS — Ultra compact 58mm thermal style
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
  
  .receipt-header {
    text-align: center;
    padding-bottom: 1.5mm;
    margin-bottom: 1.5mm;
    border-bottom: 1px dashed #000;
  }
  .salon-name {
    font-size: 12px;
    font-weight: 900;
    letter-spacing: 1px;
    margin-bottom: 0.5mm;
  }
  .receipt-type {
    font-size: 10px;
    font-weight: 800;
    background: #000;
    color: #fff;
    padding: 1mm 3mm;
    display: inline-block;
    margin: 1mm 0;
  }
  
  .receipt-info {
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
    font-size: 16px;
    font-weight: 900;
    font-family: 'Courier New', monospace;
  }
  
  .notes-section {
    margin: 2mm 0;
    padding: 1.5mm;
    border: 1px solid #ccc;
    font-size: 8px;
  }
  .notes-label {
    font-weight: 700;
    margin-bottom: 0.5mm;
  }
  .notes-text {
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

export default function ExpenseReceiptPopup({ open, expense, onClose }: ExpenseReceiptPopupProps) {
  const [printing, setPrinting] = useState(false);
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const [printError, setPrintError] = useState<LocalPrintFailure | null>(null);
  const [printSuccess, setPrintSuccess] = useState<string | null>(null);
  const autoCloseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const printLockRef = useRef(false);
  const activeRequestIdRef = useRef<string | null>(null);

  // Build receipt HTML
  const buildReceiptHTML = useCallback(() => {
    if (!expense) return '';
    
    const fmtDate = (d: string) => {
      try { 
        return new Date(d).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit', year: '2-digit' }); 
      } catch { 
        return d; 
      }
    };

    const notesSection = expense.Notes 
      ? `<div class="notes-section">
          <div class="notes-label">ملاحظات:</div>
          <div class="notes-text">${expense.Notes}</div>
         </div>` 
      : '';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>إيصال مصروف #${expense.invID}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>${RECEIPT_CSS}</style>
</head>
<body>
  <div class="receipt-header">
    <div class="salon-name">CUT SALON</div>
    <div class="receipt-type">إيصال مصروف</div>
  </div>
  
  <div class="receipt-info">
    <div class="info-row">
      <span class="info-label">رقم:</span>
      <span class="info-value">#${expense.invID}</span>
    </div>
    <div class="info-row">
      <span class="info-label">التاريخ:</span>
      <span class="info-value">${fmtDate(expense.invDate)}</span>
    </div>
    <div class="info-row">
      <span class="info-label">الوقت:</span>
      <span class="info-value">${expense.invTime}</span>
    </div>
    <div class="info-row">
      <span class="info-label">الفئة:</span>
      <span class="info-value">${expense.CatName}</span>
    </div>
    <div class="info-row">
      <span class="info-label">طريقة الدفع:</span>
      <span class="info-value">${expense.PaymentMethod || '—'}</span>
    </div>
    ${expense.UserName ? `<div class="info-row">
      <span class="info-label">المستخدم:</span>
      <span class="info-value">${expense.UserName}</span>
    </div>` : ''}
  </div>
  
  <div class="amount-box">
    <div class="amount-label">المبلغ</div>
    <div class="amount-value">${expense.GrandTolal.toLocaleString('ar-EG')} ج.م</div>
  </div>
  
  ${notesSection}
  
  <div class="divider"></div>
  
  <div class="receipt-footer">
    <div class="footer-text">تم التسجيل بنجاح</div>
    <div class="barcode-id">EXP-${String(expense.invID).padStart(4, '0')}</div>
  </div>
</body>
</html>`;
  }, [expense]);

  const handleClose = useCallback(() => {
    setVisible(false);
    // Small delay to allow exit animation
    setTimeout(() => {
      onClose();
    }, 300);
  }, [onClose]);

  // Handle visibility and auto-close (enter animation + timed dismiss)
  useEffect(() => {
    if (!(open && expense)) return;

    // Animation + print UI reset when a new receipt appears
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional enter-animation sync with open prop
    setVisible(true);
    setProgress(100);
    setPrintError(null);
    setPrintSuccess(null);
    printLockRef.current = false;
    activeRequestIdRef.current = null;

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) return 0;
        return prev - 2;
      });
    }, 100);

    const closeTimer = setTimeout(() => {
      if (!printLockRef.current) {
        handleClose();
      }
    }, 5000);

    autoCloseTimerRef.current = closeTimer;
    progressTimerRef.current = progressInterval;

    return () => {
      clearTimeout(closeTimer);
      clearInterval(progressInterval);
    };
  }, [open, expense, handleClose]);

  // Primary: Local Print Service. No about:blank / window.print on success.
  const handlePrint = useCallback(async () => {
    if (printing || printLockRef.current || !expense) return;

    printLockRef.current = true;
    setPrinting(true);
    setPrintError(null);
    setPrintSuccess(null);

    // Keep the same requestId for this attempt (idempotency across UI retries of same click)
    const requestId = activeRequestIdRef.current || createPrintRequestId(`exp-${expense.invID}`);
    activeRequestIdRef.current = requestId;

    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }

    const html = buildReceiptHTML();
    const result = await printHtmlViaLocalService({
      html,
      requestId,
      width: '58mm',
      printer: 'default',
    });

    if (result.ok) {
      setPrintSuccess(result.printer ? `تمت الطباعة عبر ${result.printer}` : 'تمت الطباعة بنجاح');
      activeRequestIdRef.current = null;
      setPrinting(false);
      printLockRef.current = false;
      return;
    }

    setPrintError(result);
    setPrinting(false);
    printLockRef.current = false;
  }, [printing, expense, buildReceiptHTML]);

  const handleBrowserFallback = useCallback(() => {
    if (printing || printLockRef.current || !expense) return;
    printLockRef.current = true;
    setPrinting(true);

    const requestId = activeRequestIdRef.current || createPrintRequestId(`exp-browser-${expense.invID}`);
    const html = buildReceiptHTML();
    const fallback = openBrowserPrintFallback(html, requestId);

    if (fallback.ok === false) {
      setPrintError(fallback);
    }

    setPrinting(false);
    printLockRef.current = false;
  }, [printing, expense, buildReceiptHTML]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, []);

  if (!expense || !open) return null;

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
            className="h-full bg-primary transition-all duration-100"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-bold">تم تسجيل المصروف</p>
              <p className="text-xs text-muted-foreground">رقم: #{expense.invID}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-accent rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {expense.ledgerNote ? (
          <p className="text-xs text-green-600 mb-2">{expense.ledgerNote}</p>
        ) : null}

        {/* Receipt Mini Preview */}
        <div className="bg-white border border-black rounded p-2 mb-3 text-black" dir="rtl">
          <div className="text-center border-b border-dashed border-black pb-1 mb-1">
            <p className="font-black text-[10px] tracking-wider">CUT SALON</p>
          </div>
          
          <div className="text-[9px] space-y-0.5 mb-1">
            <div className="flex justify-between">
              <span className="font-bold">الفئة:</span>
              <span className="truncate max-w-[100px]">{expense.CatName}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-bold">المبلغ:</span>
              <span className="font-black font-mono">{expense.GrandTolal.toLocaleString('ar-EG')} ج.م</span>
            </div>
            <div className="flex justify-between">
              <span className="font-bold">الدفع:</span>
              <span>{expense.PaymentMethod || '—'}</span>
            </div>
          </div>
          
          {expense.Notes && (
            <div className="border-t border-dashed border-black pt-1 mt-1">
              <p className="text-[8px] truncate">{expense.Notes}</p>
            </div>
          )}
        </div>

        {printSuccess && (
          <p className="text-xs text-green-600 mb-2 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {printSuccess}
          </p>
        )}

        {printError && (
          <div className="mb-2 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200 space-y-1">
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <p>{printError.userMessage}</p>
            </div>
            <p className="text-[10px] opacity-70" dir="ltr">
              {printError.code}
              {printError.requestId ? ` · ${printError.requestId}` : ''}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
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
              className="flex-1 text-xs gap-1"
              onClick={handlePrint}
              disabled={printing}
              data-testid="expense-print-button"
            >
              <Printer className="w-3 h-3" />
              {printing ? 'جاري...' : 'طباعة'}
            </Button>
          </div>
          {printError && (
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              onClick={handleBrowserFallback}
              disabled={printing}
              data-testid="expense-browser-print-fallback"
            >
              الطباعة من المتصفح
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
