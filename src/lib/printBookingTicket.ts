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
  // Raw fields (for backwards compatibility)
  bookingDate: string;
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  status: string;
  notes?: string | null;
  // Normalized Cairo display fields (preferred)
  startTimeDisplay?: string;  // e.g., "10:30 م"
  endTimeDisplay?: string;    // e.g., "11:00 م"
  dateDisplay?: string;       // e.g., "2026-06-12"
  startDateTimeCairo?: string; // ISO datetime
  endDateTimeCairo?: string;   // ISO datetime
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
 * 
 * IMPORTANT: Uses normalized Cairo display fields directly to avoid timezone shifts.
 * Do NOT parse raw SQL times - use the pre-formatted display fields from the API.
 */
function generateBookingTicketHTML(data: BookingTicketData): string {
  // DEBUG for BK-448
  const isDebug = data.bookingId === 448 || data.bookingCode?.includes('448');
  if (isDebug) {
    console.log('[printBookingTicket BK-448] Input data:', {
      bookingId: data.bookingId,
      bookingCode: data.bookingCode,
      rawStartTime: data.startTime,
      rawEndTime: data.endTime,
      rawBookingDate: data.bookingDate,
      // Normalized fields
      startTimeDisplay: data.startTimeDisplay,
      endTimeDisplay: data.endTimeDisplay,
      dateDisplay: data.dateDisplay,
      startDateTimeCairo: data.startDateTimeCairo,
      endDateTimeCairo: data.endDateTimeCairo,
      durationMinutes: data.durationMinutes,
    });
  }

  // Resolve chair number
  const chairNum = data.chairNumber ?? getChairNumber(data.empName);
  
  // Use normalized date display if available, otherwise format safely
  let dateStr: string;
  if (data.dateDisplay) {
    dateStr = data.dateDisplay;
  } else {
    // Fallback: format from ISO string - but don't use new Date() on raw SQL dates
    const dateObj = new Date(data.bookingDate);
    dateStr = dateObj.toLocaleDateString('ar-EG', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }

  // Use pre-formatted display times from API (Cairo-normalized)
  // These are already formatted as "10:30 م" - no parsing needed
  let startTimeStr: string;
  let endTimeStr: string | null;

  if (data.startTimeDisplay) {
    // Use normalized display field directly
    startTimeStr = data.startTimeDisplay;
    if (isDebug) console.log('[printBookingTicket BK-448] Using startTimeDisplay:', startTimeStr);
  } else {
    // Fallback: format from time string (should not happen with updated API)
    startTimeStr = formatTimeFromString(data.startTime);
    if (isDebug) console.log('[printBookingTicket BK-448] Fallback format startTime:', startTimeStr);
  }

  if (data.endTimeDisplay) {
    endTimeStr = data.endTimeDisplay;
    if (isDebug) console.log('[printBookingTicket BK-448] Using endTimeDisplay:', endTimeStr);
  } else if (data.endTime) {
    // Fallback: format from endTime
    endTimeStr = formatTimeFromString(data.endTime);
    if (isDebug) console.log('[printBookingTicket BK-448] Fallback format endTime:', endTimeStr);
  } else if (data.startDateTimeCairo && data.durationMinutes) {
    // Calculate end from start + duration
    const startMs = new Date(data.startDateTimeCairo).getTime();
    const endMs = startMs + data.durationMinutes * 60000;
    const endDate = new Date(endMs);
    // Format using the same method as the backend
    endTimeStr = formatTimeArabic(endDate);
    if (isDebug) console.log('[printBookingTicket BK-448] Calculated end from duration:', endTimeStr);
  } else {
    endTimeStr = null;
  }

  if (isDebug) {
    console.log('[printBookingTicket BK-448] Final print values:', {
      startTimeStr,
      endTimeStr,
      dateStr,
      durationMinutes: data.durationMinutes,
    });
  }

  // Helper: Format time from HH:mm string (fallback only)
  function formatTimeFromString(timeStr: string): string {
    if (!timeStr) return 'غير محدد';
    const [h, m] = timeStr.split(':');
    if (!h || !m) return timeStr;
    const hour = parseInt(h);
    const minute = parseInt(m);
    const period = hour >= 12 ? 'م' : 'ص';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
  }

  // Helper: Format time from Date using Cairo timezone (fallback only)
  function formatTimeArabic(date: Date): string {
    try {
      const parts = new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      }).formatToParts(date);
      const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
      const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
      const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
      const period = dayPeriod.includes('ص') ? 'ص' : dayPeriod.includes('م') ? 'م' : dayPeriod;
      return `${hour}:${minute} ${period}`;
    } catch {
      // Fallback to local time
      const h = date.getHours();
      const m = date.getMinutes();
      const period = h >= 12 ? 'م' : 'ص';
      const displayHour = h % 12 || 12;
      return `${displayHour}:${m.toString().padStart(2, '0')} ${period}`;
    }
  }

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
    @page { 
      size: 72mm auto; 
      margin: 0; 
    }

    * { 
      margin: 0; 
      padding: 0; 
      box-sizing: border-box; 
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    body {
      width: 72mm;
      padding: 4mm 3mm;
      background: #fff;
      color: #000;
      font-family: Tahoma, Arial, sans-serif;
      font-size: 13px;
      font-weight: 900;
      line-height: 1.45;
    }

    .center { 
      text-align: center; 
    }

    .header {
      font-size: 19px;
      font-weight: 900;
      letter-spacing: 1px;
      line-height: 1.1;
      margin-bottom: 2px;
    }

    .subheader {
      font-size: 14px;
      font-weight: 900;
      margin-bottom: 5px;
    }

    .divider {
      border-top: 2px solid #000;
      margin: 6px 0;
    }

    .divider-thin {
      border-top: 1.5px solid #000;
      margin: 5px 0;
    }

    .booking-code-box {
      border: 3px solid #000;
      padding: 7px 4px;
      margin: 6px 0;
      text-align: center;
    }

    .booking-code {
      font-size: 34px;
      font-weight: 900;
      letter-spacing: 1px;
      line-height: 1;
    }

    .booking-code-label {
      font-size: 12px;
      font-weight: 900;
      margin-top: 4px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 5px;
      margin: 4px 0;
      border-bottom: 1px solid #000;
      padding-bottom: 3px;
    }

    .row-label {
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }

    .row-value {
      font-size: 14px;
      font-weight: 900;
      text-align: left;
      flex: 1;
      word-break: break-word;
    }

    .main-box {
      border: 2px solid #000;
      padding: 6px 4px;
      margin: 6px 0;
      text-align: center;
    }

    .main-label {
      font-size: 12px;
      font-weight: 900;
      margin-bottom: 3px;
    }

    .main-value {
      font-size: 18px;
      font-weight: 900;
      line-height: 1.2;
    }

    .two-col {
      display: flex;
      gap: 4px;
      margin: 6px 0;
    }

    .two-col .main-box {
      flex: 1;
      margin: 0;
    }

    .black-box {
      background: #000;
      color: #fff;
      border: 3px solid #000;
    }

    .black-box .main-label,
    .black-box .main-value {
      color: #fff;
    }

    .time-value {
      font-size: 20px;
      font-weight: 900;
      direction: rtl;
      white-space: nowrap;
    }

    .footer {
      font-size: 12px;
      font-weight: 900;
      text-align: center;
      margin-top: 7px;
      padding-top: 5px;
      border-top: 2px solid #000;
    }

    .footer-note {
      font-size: 11px;
      font-weight: 900;
      margin-top: 3px;
    }
  </style>
</head>

<body>
  <div class="center">
    <div class="header">CUT SALON</div>
    <div class="subheader">ورقة حجز</div>
  </div>

  <div class="divider"></div>

  <div class="booking-code-box">
    <div class="booking-code">${data.bookingCode}</div>
    <div class="booking-code-label">رقم الحجز</div>
  </div>

  <div class="row">
    <span class="row-label">العميل</span>
    <span class="row-value">${data.customerName || 'غير محدد'}</span>
  </div>

  ${data.customerPhone ? `
  <div class="row">
    <span class="row-label">الهاتف</span>
    <span class="row-value" dir="ltr">${data.customerPhone}</span>
  </div>
  ` : ''}

  <div class="two-col">
    <div class="main-box">
      <div class="main-label">الحلاق</div>
      <div class="main-value">${data.empName || 'غير محدد'}</div>
    </div>

    ${chairNum ? `
    <div class="main-box black-box">
      <div class="main-label">الكرسي</div>
      <div class="main-value">${chairNum}</div>
    </div>
    ` : ''}
  </div>

  <div class="main-box">
    <div class="main-label">الخدمة</div>
    <div class="main-value">${servicesText}</div>
  </div>

  <div class="divider"></div>

  <div class="two-col">
    <div class="main-box">
      <div class="main-label">وقت الحجز</div>
      <div class="main-value time-value">${startTimeStr}</div>
    </div>

    ${endTimeStr ? `
    <div class="main-box">
      <div class="main-label">الانتهاء</div>
      <div class="main-value time-value">${endTimeStr}</div>
    </div>
    ` : ''}
  </div>

  <div class="row">
    <span class="row-label">التاريخ</span>
    <span class="row-value">${dateStr}</span>
  </div>

  <div class="row">
    <span class="row-label">الحالة</span>
    <span class="row-value">${statusLabel}</span>
  </div>

  ${totalDuration > 0 ? `
  <div class="row">
    <span class="row-label">المدة</span>
    <span class="row-value">${totalDuration} دقيقة</span>
  </div>
  ` : ''}

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
