// Local Print Service Integration
const PRINT_SERVICE_URL = 'http://127.0.0.1:7788';

export interface PrintReceiptData {
  invID: number;
  invDate: string;
  invTime: string;
  customerName?: string;
  customerPhone?: string;
  SubTotal: number;
  Dis: number;
  DisVal: number;
  GrandTotal: number;
  PayCash: number;
  PayVisa: number;
  PaymentMethodID: number | null;
  items: Array<{
    ProName: string;
    EmpName: string;
    SPrice: number;
    Qty: number;
    SPriceAfterDis: number;
    Dis?: number;
    DisVal?: number;
    SValue?: number;
  }>;
}

export interface PrintServiceResponse {
  success: boolean;
  message?: string;
  error?: string;
  invoiceId?: number;
  printer?: string;
  ok?: boolean;
}

/**
 * Check if the local print service is reachable and healthy.
 * Uses a 1500ms AbortController timeout.
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
 * Send receipt payload to the local print service.
 * Uses a 15000ms AbortController timeout (Puppeteer needs ~5-10s to render PDF).
 * Throws if the service returns a failure response.
 */
async function sendToLocalPrintService(data: PrintReceiptData): Promise<PrintServiceResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const res = await fetch(`${PRINT_SERVICE_URL}/print/receipt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  const result: PrintServiceResponse | null = await res.json().catch(() => null);

  if (!res.ok || !result || result.success === false || result.ok === false) {
    throw new Error(result?.error || result?.message || 'Local print failed');
  }

  return result;
}

/**
 * Primary entry point for post-sale receipt printing.
 *
 * Flow:
 *  1. Health-check the local print service (1500ms timeout).
 *  2. If healthy, send the receipt via POST /print/receipt (15s timeout — Puppeteer needs time).
 *  3. Returns true if local print succeeded (caller must NOT open browser modal).
 *  4. Returns false if any step fails — caller should open browser fallback modal.
 *  5. If a toast callback is provided, shows a warning when falling back.
 *
 * Awaitable — caller should await this and use the return value to decide
 * whether to open the browser print modal.
 */
export async function printReceiptWithFallback(
  invoiceData: PrintReceiptData,
  browserFallback: () => void,
  addToast?: (type: 'success' | 'error' | 'info', message: string) => void,
): Promise<boolean> {
  try {
    console.log('[print] Trying print-service...');
    const available = await isLocalPrintServiceAvailable();

    if (!available) {
      console.warn('[print] Print-service failed, opening browser print fallback');
      addToast?.('info', 'الطابعة المحلية غير متاحة — جاري الطباعة عبر المتصفح');
      console.log('[print] Browser print modal opened');
      browserFallback();
      console.log('[print] Print flow finished (browser fallback)');
      return false;
    }

    try {
      const result = await sendToLocalPrintService(invoiceData);
      console.log(`[print] Print-service success, skipping browser print modal — printer: ${result.printer ?? 'unknown'}, invoice: ${invoiceData.invID}`);
      addToast?.('success', 'تمت الطباعة بنجاح');
      console.log('[print] Print flow finished (local service)');
      return true;
    } catch (printErr) {
      console.warn('[print] Print-service failed, opening browser print fallback', printErr instanceof Error ? printErr.message : printErr);
      addToast?.('info', 'فشلت الطباعة المحلية — جاري الطباعة عبر المتصفح');
      console.log('[print] Browser print modal opened');
      browserFallback();
      console.log('[print] Print flow finished (browser fallback after service error)');
      return false;
    }
  } catch (err) {
    console.warn('[print] Print-service failed, opening browser print fallback', err instanceof Error ? err.message : err);
    addToast?.('info', 'فشلت الطباعة المحلية — جاري الطباعة عبر المتصفح');
    console.log('[print] Browser print modal opened');
    browserFallback();
    console.log('[print] Print flow finished (browser fallback after error)');
    return false;
  }
}

/**
 * @deprecated Use printReceiptWithFallback instead.
 * Kept for backward compatibility.
 */
export async function printReceiptAfterSale(invoiceData: PrintReceiptData): Promise<void> {
  (async () => {
    try {
      const available = await isLocalPrintServiceAvailable();
      if (!available) {
        console.log('[print] local print failed, using browser fallback (legacy call)');
        return;
      }
      console.log('[print] local service available');
      const result = await sendToLocalPrintService(invoiceData);
      console.log(`[print] local print success — printer: ${result.printer ?? 'unknown'}`);
    } catch (error) {
      console.log('[print] local print failed, using browser fallback', error instanceof Error ? error.message : 'Unknown error');
    }
  })();
}

/**
 * Check if the print service is available
 */
export async function checkPrintServiceHealth(): Promise<boolean> {
  return isLocalPrintServiceAvailable();
}

/**
 * Show a toast notification for print service status
 */
export async function showPrintServiceStatus(addToast: (type: 'success' | 'error' | 'info', message: string) => void) {
  const isHealthy = await isLocalPrintServiceAvailable();

  if (isHealthy) {
    addToast('info', 'خدمة الطباعة جاهزة');
  } else {
    addToast('error', 'خدمة الطباعة غير متصلة - لن تتم الطباعة التلقائية');
  }
}
