import type { QueueTicketPrintData } from '@/components/queue/QueueTicketPrint';
import { normalizeCustomersAhead } from '@/lib/queueCustomersAhead';

// ─────────────────────────────────────────────────────────────
// Queue Ticket Receipt CSS — 80mm thermal, mirrors ExpenseReceiptPopup
// ─────────────────────────────────────────────────────────────
const RECEIPT_CSS = `
  @page {
    size: 72mm auto;
    margin: 0mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 72mm;
    max-width: 72mm;
    overflow: hidden;
    font-family: 'Cairo', Tahoma, Arial, sans-serif;
    direction: rtl;
    font-size: 10px;
    line-height: 1.3;
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
  .logo-img {
    max-height: 12mm;
    max-width: 24mm;
    object-fit: contain;
    margin-bottom: 1mm;
    display: block;
    margin-left: auto;
    margin-right: auto;
  }
  .salon-name {
    font-size: 13px;
    font-weight: 900;
    letter-spacing: 1px;
    margin-bottom: 0.5mm;
  }
  .salon-sub {
    font-size: 8px;
    color: #555;
  }
  .ticket-type {
    font-size: 9px;
    font-weight: 800;
    background: #000;
    color: #fff;
    padding: 0.8mm 3mm;
    display: inline-block;
    margin: 1.5mm 0 0.5mm;
    letter-spacing: 1px;
  }

  .ticket-number-wrap {
    text-align: center;
    margin: 2mm 0 1.5mm;
  }
  .ticket-label {
    font-size: 8px;
    color: #555;
    letter-spacing: 1px;
    margin-bottom: 0;
  }
  .ticket-code {
    font-size: 44px;
    font-weight: 900;
    letter-spacing: -1px;
    line-height: 1.0;
    color: #000;
  }

  .divider {
    border-top: 1px dashed #000;
    margin: 1.5mm 0;
  }

  .info-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 4px;
    margin-bottom: 1mm;
    padding-bottom: 0.5mm;
    font-size: 9px;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .info-label {
    font-weight: 700;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .info-value {
    font-weight: 600;
    text-align: left;
  }

  .receipt-footer {
    text-align: center;
    margin-top: 2mm;
    padding-top: 1.5mm;
    border-top: 1px dashed #000;
    font-size: 8px;
    line-height: 1.6;
  }
  .footer-text { font-weight: 700; }
  .brand-line {
    font-size: 7px;
    color: #666;
    margin-top: 1mm;
  }
`;

function buildReceiptHtml(data: QueueTicketPrintData): string {
  const {
    ticketCode,
    clientName,
    empName,
    services = [],
    queueDate,
    createdTime,
    waitingBefore,
    estimatedWaitMinutes,
    estimatedStartTime,
  } = data;

  const dateLabel = queueDate
    ? new Date(queueDate).toLocaleDateString('ar-EG', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      })
    : null;

  const timeLabel = createdTime ? createdTime.slice(0, 5) : null;

  const estTimeLabel = estimatedStartTime
    ? (() => {
        const d = new Date(estimatedStartTime);
        const h = d.getHours() % 12 || 12;
        const m = String(d.getMinutes()).padStart(2, '0');
        const p = d.getHours() < 12 ? 'ص' : 'م';
        return `${h}:${m} ${p}`;
      })()
    : null;

  const row = (label: string, value: string, ltr = false) =>
    `<div class="info-row">
      <span class="info-label">${label}:</span>
      <span class="info-value"${ltr ? ' dir="ltr"' : ''}>${value}</span>
    </div>`;

  const customersAhead = normalizeCustomersAhead(waitingBefore);

  const rows = [
    clientName                      ? row('العميل',            clientName)                                  : '',
    empName                         ? row('الحلاق',             empName)                                     : '',
    services.length > 0             ? row('الخدمات',            services.map(s => s.name).join('، '))        : '',
    dateLabel                       ? row('التاريخ',            dateLabel)                                   : '',
    timeLabel                       ? row('وقت الإصدار',       timeLabel, true)                             : '',
    row('أمامك في الانتظار', String(customersAhead)),
    estTimeLabel                    ? row('الدخول المتوقع',    estTimeLabel, true)                          : '',
    (estimatedWaitMinutes ?? 0) > 0 ? row('انتظار تقريبي',     `~${estimatedWaitMinutes} د`)                : '',
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8"/>
  <title>تذكرة انتظار ${ticketCode}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
  <style>${RECEIPT_CSS}</style>
</head>
<body>
  <div class="receipt-header">
    <img class="logo-img" src="/cutsalon.png" alt="" onerror="this.style.display='none'" />
    <div class="salon-name">CUT SALON</div>
    <div class="salon-sub">صالون كَت للحلاقة</div>
    <div class="ticket-type">تذكرة انتظار</div>
  </div>

  <div class="ticket-number-wrap">
    <div class="ticket-label">رقم الانتظار</div>
    <div class="ticket-code">${ticketCode || '—'}</div>
  </div>

  <div class="divider"></div>

  ${rows}

  <div class="receipt-footer">
    <div class="footer-text">برجاء الاحتفاظ برقم الدور</div>
    <div>سيتم النداء عليك عند اقتراب موعدك</div>
    <div class="brand-line">شكراً لاختياركم Cut Salon ✂</div>
  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────
// printQueueTicket — same popup window pattern as ExpenseReceiptPopup
// ─────────────────────────────────────────────────────────────
let _printWin: Window | null = null;

export function printQueueTicket(data: QueueTicketPrintData): boolean {
  console.log('[queue print] printing ticket', data);

  if (_printWin && !_printWin.closed) {
    _printWin.close();
  }

  const win = window.open('', '_blank', 'width=300,height=400');
  return printQueueTicketInWindow(win, data);
}

export function printQueueTicketInWindow(
  win: Window | null,
  data: QueueTicketPrintData,
): boolean {
  if (!win || win.closed) {
    console.error('[queue print] popup unavailable');
    return false;
  }

  _printWin = win;
  const html = buildReceiptHtml(data);
  win.document.write(html);
  win.document.close();

  win.onload = () => {
    win.onafterprint = () => {
      win.close();
      _printWin = null;
    };

    win.print();

    setTimeout(() => {
      if (_printWin && !_printWin.closed) {
        _printWin.close();
        _printWin = null;
      }
    }, 10_000);
  };

  return true;
}
