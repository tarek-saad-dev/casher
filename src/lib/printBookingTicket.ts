/**
 * Booking Ticket Printing Service
 * Prints thermal booking tickets (80mm/72mm) for customers
 * Uses local print service with browser fallback
 */

import { getChairNumber, getChairDisplayText } from './chairMapping';

export interface BookingTicketData {
  bookingId: number;
  bookingCode: string;
  customerName: string;
  customerPhone?: string;
  empName: string;
  chairNumber?: number | null;
  services: Array<{
    name: string;
    durationMinutes?: number;
    price?: number;
  }>;
  bookingDate: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  status: string;
  notes?: string | null;
}

interface PrintServiceResponse {
  success: boolean;
  message?: string;
  error?: string;
  printer?: string;
  ok?: boolean;
}

const PRINT_SERVICE_URL = 'http://127.0.0.1:7788';

/**
 * Check if the local print service is available
 */
async function isLocalPrintServiceAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${PRINT_SERVICE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.status === 'ok' || data?.ok === true || res.ok;
  } catch {
    return false;
  }
}

/**
 * Generate compact thermal ticket HTML for booking (72mm printer - XP-80)
 * Optimized for: shorter length, bolder typography, clear hierarchy
 */
function generateBookingTicketHTML(data: BookingTicketData): string {
  // Resolve chair number
  const chairNum = data.chairNumber ?? getChairNumber(data.empName);
  
  // Format date compact
  const dateObj = new Date(data.bookingDate);
  const dateStr = dateObj.toLocaleDateString('ar-EG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  // Format time
  const formatTime = (timeStr: string) => {
    if (!timeStr) return 'غير محدد';
    const [h, m] = timeStr.split(':');
    if (!h || !m) return timeStr;
    const hour = parseInt(h);
    const minute = parseInt(m);
    const period = hour >= 12 ? 'م' : 'ص';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  };

  const startTimeStr = formatTime(data.startTime);
  const endTimeStr = data.endTime ? formatTime(data.endTime) : null;

  // Status label
  const statusLabels: Record<string, string> = {
    pending: 'معلق',
    confirmed: 'مؤكد',
    arrived: 'وصل',
    queued: 'في الدور',
    in_service: 'قيد الخدمة',
    completed: 'مكتمل',
    cancelled: 'ملغي',
    no_show: 'لم يحضر',
  };
  const statusLabel = statusLabels[data.status] || data.status;

  // Services compact - max 2 lines
  let servicesText = 'غير محدد';
  if (data.services.length > 0) {
    const serviceNames = data.services.map(s => s.name).filter(Boolean);
    if (serviceNames.length <= 2) {
      servicesText = serviceNames.join(' + ');
    } else {
      servicesText = `${serviceNames.slice(0, 2).join(' + ')} + المزيد`;
    }
  }

  // Duration
  const totalDuration = data.durationMinutes || 
    data.services.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);

  return `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: 72mm auto; margin: 0; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      width: 72mm;
      padding: 3mm 2.5mm;
      background: #fff;
      color: #000;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.25;
    }
    .center { text-align: center; }
    .header {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .subheader {
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 4px;
    }
    .divider {
      border-top: 1.5px solid #000;
      margin: 4px 0;
    }
    .divider-thin {
      border-top: 0.5px solid #000;
      margin: 3px 0;
    }
    .booking-code-box {
      border: 2px solid #000;
      padding: 6px 4px;
      margin: 4px 0;
      text-align: center;
    }
    .booking-code {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 1px;
      line-height: 1;
    }
    .booking-code-label {
      font-size: 9px;
      font-weight: 700;
      margin-top: 2px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 2px 0;
      gap: 4px;
    }
    .row-label {
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .row-value {
      font-size: 12px;
      font-weight: 800;
      text-align: left;
      flex: 1;
    }
    .important-row {
      display: flex;
      justify-content: space-between;
      gap: 4px;
      margin: 4px 0;
    }
    .important-box {
      flex: 1;
      border: 1.5px solid #000;
      padding: 4px 2px;
      text-align: center;
    }
    .important-label {
      font-size: 9px;
      font-weight: 700;
      margin-bottom: 1px;
    }
    .important-value {
      font-size: 13px;
      font-weight: 900;
      line-height: 1.1;
    }
    .chair-box {
      background: #000;
      color: #fff;
    }
    .chair-value {
      font-size: 14px;
      font-weight: 900;
    }
    .footer {
      font-size: 9px;
      font-weight: 700;
      text-align: center;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1.5px solid #000;
    }
    .footer-note {
      font-size: 8px;
      font-weight: 600;
      margin-top: 2px;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="center">
    <div class="header">CUT SALON</div>
    <div class="subheader">ورقة حجز</div>
  </div>

  <div class="divider"></div>

  <!-- Booking Code (Most Important) -->
  <div class="booking-code-box">
    <div class="booking-code">${data.bookingCode}</div>
    <div class="booking-code-label">رقم الحجز</div>
  </div>

  <div class="divider-thin"></div>

  <!-- Customer Info -->
  <div class="row">
    <span class="row-label">العميل:</span>
    <span class="row-value">${data.customerName || 'غير محدد'}</span>
  </div>
  ${data.customerPhone ? `
  <div class="row">
    <span class="row-label">الهاتف:</span>
    <span class="row-value" dir="ltr">${data.customerPhone}</span>
  </div>
  ` : ''}

  <div class="divider-thin"></div>

  <!-- Barber & Chair (Important) -->
  <div class="important-row">
    <div class="important-box">
      <div class="important-label">الحلاق</div>
      <div class="important-value">${data.empName || 'غير محدد'}</div>
    </div>
    ${chairNum ? `
    <div class="important-box chair-box">
      <div class="important-label" style="color: #fff;">الكرسي</div>
      <div class="chair-value">${chairNum}</div>
    </div>
    ` : ''}
  </div>

  <!-- Service -->
  <div class="row">
    <span class="row-label">الخدمة:</span>
    <span class="row-value">${servicesText}</span>
  </div>

  <div class="divider-thin"></div>

  <!-- Time & Date -->
  <div class="important-row">
    <div class="important-box">
      <div class="important-label">وقت الحجز</div>
      <div class="important-value">${startTimeStr}</div>
    </div>
    ${endTimeStr ? `
    <div class="important-box">
      <div class="important-label">الانتهاء</div>
      <div class="important-value">${endTimeStr}</div>
    </div>
    ` : ''}
  </div>

  <!-- Date & Status Row -->
  <div class="row" style="margin-top: 4px;">
    <span class="row-label">التاريخ:</span>
    <span class="row-value" style="font-size: 11px;">${dateStr}</span>
  </div>
  <div class="row">
    <span class="row-label">الحالة:</span>
    <span class="row-value">${statusLabel}</span>
  </div>
  ${totalDuration > 0 ? `
  <div class="row">
    <span class="row-label">المدة:</span>
    <span class="row-value">${totalDuration} دقيقة</span>
  </div>
  ` : ''}

  <div class="divider"></div>

  <!-- Footer -->
  <div class="footer">
    <div>يرجى تسليم الورقة قبل الدخول</div>
    <div class="footer-note">شكراً لاختياركم Cut Salon</div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Open browser print with ticket HTML
 */
function openBrowserPrint(html: string): void {
  const printWindow = window.open('', '_blank', 'width=400,height=600');
  if (!printWindow) {
    console.error('[printBookingTicket] Failed to open print window');
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();

  // Wait for content to load then print
  setTimeout(() => {
    printWindow.print();
    // Close window after print (some browsers block this, which is fine)
    setTimeout(() => {
      try {
        printWindow.close();
      } catch {
        // Ignore if can't close
      }
    }, 1000);
  }, 500);
}

/**
 * Send booking ticket to local print service
 */
async function sendToLocalPrintService(html: string): Promise<PrintServiceResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(`${PRINT_SERVICE_URL}/print/html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        width: '80mm',
        printer: 'default',
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const result: PrintServiceResponse | null = await res.json().catch(() => null);

    if (!res.ok || !result || result.success === false || result.ok === false) {
      throw new Error(result?.error || result?.message || 'Local print failed');
    }

    return result;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Print booking ticket
 * Uses local print service if available, otherwise opens browser print
 * Does NOT change booking status
 */
export async function printBookingTicket(
  data: BookingTicketData,
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void,
): Promise<boolean> {
  try {
    console.log('[printBookingTicket] Starting print for booking:', data.bookingCode);

    // Auto-resolve chair number if not provided
    if (!data.chairNumber && data.empName) {
      data.chairNumber = getChairNumber(data.empName);
    }

    const html = generateBookingTicketHTML(data);

    // Try local print service first
    const available = await isLocalPrintServiceAvailable();

    if (available) {
      try {
        await sendToLocalPrintService(html);
        console.log('[printBookingTicket] Local print service success');
        addToast?.('success', 'تم إرسال ورقة الحجز للطباعة');
        return true;
      } catch (serviceErr) {
        console.warn('[printBookingTicket] Local service failed, using browser fallback:', serviceErr);
      }
    }

    // Browser fallback
    console.log('[printBookingTicket] Using browser print fallback');
    openBrowserPrint(html);
    addToast?.('info', 'تم فتح نافذة الطباعة');
    return false;

  } catch (err) {
    console.error('[printBookingTicket] Error:', err);
    addToast?.('error', 'تعذر الطباعة، حاول مرة أخرى');
    return false;
  }
}

/**
 * Generate print-ready HTML without printing (for custom handling)
 */
export function generateBookingTicketHTMLOnly(data: BookingTicketData): string {
  if (!data.chairNumber && data.empName) {
    data.chairNumber = getChairNumber(data.empName);
  }
  return generateBookingTicketHTML(data);
}
