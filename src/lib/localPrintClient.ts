/**
 * Local Print Service HTTP client.
 * Primary path for thermal printing; browser print is a manual fallback only.
 */

export const PRINT_SERVICE_URL = 'http://127.0.0.1:7788';

export type PrintErrorCode =
  | 'SERVICE_UNAVAILABLE'
  | 'NETWORK_ERROR'
  | 'CORS_BLOCKED'
  | 'HTTP_ERROR'
  | 'INVALID_PAYLOAD'
  | 'PRINTER_NOT_FOUND'
  | 'PRINTER_OFFLINE'
  | 'SPOOLER_ERROR'
  | 'PRINT_COMMAND_FAILED'
  | 'BROWSER_PRINT_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface LocalPrintSuccess {
  ok: true;
  requestId: string;
  printer?: string;
  message?: string;
}

export interface LocalPrintFailure {
  ok: false;
  requestId: string;
  code: PrintErrorCode;
  stage?: string;
  message: string;
  userMessage: string;
  httpStatus?: number;
}

export type LocalPrintResult = LocalPrintSuccess | LocalPrintFailure;

export interface PrintHtmlPayload {
  html: string;
  requestId?: string;
  width?: string;
  printer?: string;
}

const ARABIC_MESSAGES: Record<PrintErrorCode, string> = {
  SERVICE_UNAVAILABLE: 'تعذر الوصول إلى خدمة الطباعة المحلية على هذا الجهاز.',
  NETWORK_ERROR: 'فشل الاتصال بخدمة الطباعة المحلية. تحقق من تشغيل الخدمة.',
  CORS_BLOCKED: 'المتصفح منع الاتصال بخدمة الطباعة المحلية (CORS).',
  HTTP_ERROR: 'خدمة الطباعة أعادت خطأ غير متوقع.',
  INVALID_PAYLOAD: 'بيانات الإيصال غير صالحة للطباعة.',
  PRINTER_NOT_FOUND: 'تم الوصول إلى خدمة الطباعة، لكن الطابعة غير متاحة.',
  PRINTER_OFFLINE: 'الطابعة غير متصلة أو في وضع Offline.',
  SPOOLER_ERROR: 'فشل Windows في إرسال المهمة إلى الطابعة. راجع قائمة انتظار الطباعة.',
  PRINT_COMMAND_FAILED: 'فشلت عملية الطباعة داخل خدمة الطباعة المحلية.',
  BROWSER_PRINT_FAILED: 'فشلت الطباعة من المتصفح.',
  TIMEOUT: 'انتهت مهلة الاتصال بخدمة الطباعة المحلية.',
  UNKNOWN: 'تعذرت الطباعة لسبب غير معروف.',
};

export function createPrintRequestId(prefix = 'exp'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function userMessageForCode(code: PrintErrorCode, printerName?: string): string {
  if (code === 'PRINTER_NOT_FOUND' && printerName) {
    return `تم الوصول إلى خدمة الطباعة، لكن الطابعة ${printerName} غير متاحة.`;
  }
  return ARABIC_MESSAGES[code] || ARABIC_MESSAGES.UNKNOWN;
}

function classifyFetchError(err: unknown): PrintErrorCode {
  if (!(err instanceof Error)) return 'UNKNOWN';
  if (err.name === 'AbortError') return 'TIMEOUT';
  const msg = err.message.toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) {
    return 'NETWORK_ERROR';
  }
  if (msg.includes('cors')) return 'CORS_BLOCKED';
  return 'NETWORK_ERROR';
}

function classifyServiceCode(code?: string, message?: string): PrintErrorCode {
  const c = (code || '').toUpperCase();
  const known: PrintErrorCode[] = [
    'SERVICE_UNAVAILABLE',
    'NETWORK_ERROR',
    'CORS_BLOCKED',
    'HTTP_ERROR',
    'INVALID_PAYLOAD',
    'PRINTER_NOT_FOUND',
    'PRINTER_OFFLINE',
    'SPOOLER_ERROR',
    'PRINT_COMMAND_FAILED',
    'BROWSER_PRINT_FAILED',
    'TIMEOUT',
  ];
  if (known.includes(c as PrintErrorCode)) return c as PrintErrorCode;

  const msg = (message || '').toLowerCase();
  if (msg.includes('not found') || msg.includes('cannot find')) return 'PRINTER_NOT_FOUND';
  if (msg.includes('offline')) return 'PRINTER_OFFLINE';
  if (msg.includes('spool')) return 'SPOOLER_ERROR';
  if (msg.includes('missing') || msg.includes('invalid') || msg.includes('required')) return 'INVALID_PAYLOAD';
  return 'PRINT_COMMAND_FAILED';
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Health-check with short timeout. Does not throw.
 */
export async function checkLocalPrintServiceHealth(
  timeoutMs = 1500,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetchImpl(`${PRINT_SERVICE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.status === 'ok' || data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Send HTML to POST /print/html. Does NOT open browser print.
 */
export async function printHtmlViaLocalService(
  payload: PrintHtmlPayload,
  options?: {
    timeoutMs?: number;
    fetchImpl?: FetchLike;
  },
): Promise<LocalPrintResult> {
  const requestId = payload.requestId || createPrintRequestId('print');
  const fetchImpl = options?.fetchImpl ?? fetch;
  const timeoutMs = options?.timeoutMs ?? 20000;

  console.log(`[print][${requestId}] started`);
  console.log(`[print][${requestId}] serviceUrl`, `${PRINT_SERVICE_URL}/print/html`);
  console.log(`[print][${requestId}] payload summary`, {
    htmlLength: payload.html?.length ?? 0,
    width: payload.width ?? '80mm',
    printer: payload.printer ?? 'default',
  });

  const healthy = await checkLocalPrintServiceHealth(1500, fetchImpl);
  if (!healthy) {
    console.log(`[print][${requestId}] failed`, { code: 'SERVICE_UNAVAILABLE' });
    return {
      ok: false,
      requestId,
      code: 'SERVICE_UNAVAILABLE',
      stage: 'browser_request',
      message: 'Print service health check failed',
      userMessage: userMessageForCode('SERVICE_UNAVAILABLE'),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(`${PRINT_SERVICE_URL}/print/html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        html: payload.html,
        width: payload.width ?? '80mm',
        printer: payload.printer ?? 'default',
        requestId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const rawText = await res.text();
    console.log(`[print][${requestId}] response status`, res.status);
    console.log(`[print][${requestId}] response body`, rawText.slice(0, 500));

    let body: {
      ok?: boolean;
      success?: boolean;
      message?: string;
      error?: string;
      code?: string;
      stage?: string;
      printer?: string;
      requestId?: string;
    } | null = null;

    try {
      body = rawText ? JSON.parse(rawText) : null;
    } catch {
      console.log(`[print][${requestId}] failed`, { code: 'HTTP_ERROR', reason: 'invalid JSON' });
      return {
        ok: false,
        requestId,
        code: 'HTTP_ERROR',
        stage: 'browser_request',
        message: 'Invalid JSON from print service',
        userMessage: userMessageForCode('HTTP_ERROR'),
        httpStatus: res.status,
      };
    }

    const success = res.ok && body && (body.ok === true || body.success === true);
    if (success) {
      console.log(`[print][${requestId}] success`, { printer: body?.printer });
      return {
        ok: true,
        requestId: body?.requestId || requestId,
        printer: body?.printer,
        message: body?.message,
      };
    }

    const code = classifyServiceCode(body?.code, body?.message || body?.error);
    console.log(`[print][${requestId}] failed`, { code, stage: body?.stage });
    return {
      ok: false,
      requestId: body?.requestId || requestId,
      code,
      stage: body?.stage,
      message: body?.message || body?.error || `HTTP ${res.status}`,
      userMessage: userMessageForCode(code, body?.printer),
      httpStatus: res.status,
    };
  } catch (err) {
    clearTimeout(timeout);
    const code = classifyFetchError(err);
    console.log(`[print][${requestId}] failed`, {
      code,
      name: err instanceof Error ? err.name : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      requestId,
      code,
      stage: 'browser_request',
      message: err instanceof Error ? err.message : 'Network error',
      userMessage: userMessageForCode(code),
    };
  }
}

/**
 * Open about:blank and call window.print — manual fallback only.
 */
export function openBrowserPrintFallback(html: string, requestId?: string): { ok: true } | LocalPrintFailure {
  const id = requestId || createPrintRequestId('browser');
  console.log(`[print][${id}] fallback started`);
  try {
    const win = window.open('', '_blank', 'width=300,height=400');
    if (!win) {
      return {
        ok: false,
        requestId: id,
        code: 'BROWSER_PRINT_FAILED',
        stage: 'browser_request',
        message: 'Popup blocked',
        userMessage: 'تم حظر نافذة الطباعة من المتصفح. اسمح بالنوافذ المنبثقة ثم أعد المحاولة.',
      };
    }
    win.document.write(html);
    win.document.close();
    let printed = false;
    const doPrint = () => {
      if (printed || win.closed) return;
      printed = true;
      try {
        win.print();
      } catch (e) {
        console.log(`[print][${id}] failed`, {
          code: 'BROWSER_PRINT_FAILED',
          message: e instanceof Error ? e.message : String(e),
        });
      }
    };
    win.onload = () => doPrint();
    // document.write may not fire load reliably in all browsers
    setTimeout(doPrint, 400);
    return { ok: true };
  } catch (err) {
    console.log(`[print][${id}] failed`, {
      code: 'BROWSER_PRINT_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      requestId: id,
      code: 'BROWSER_PRINT_FAILED',
      stage: 'browser_request',
      message: err instanceof Error ? err.message : 'Browser print failed',
      userMessage: userMessageForCode('BROWSER_PRINT_FAILED'),
    };
  }
}
