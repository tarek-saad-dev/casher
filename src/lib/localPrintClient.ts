/**
 * Local Print Service HTTP client.
 * Primary path for thermal printing; browser print is a manual fallback only.
 */

export const PRINT_SERVICE_URL = 'http://127.0.0.1:7788';
export const REQUIRED_AGENT_VERSION = '2.0.0';

export type LoopbackPermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported';

/** Query granular Chrome Loopback permission. Avoid deprecated local-network-access. */
export async function getLoopbackPermissionState(): Promise<LoopbackPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unsupported';
  try {
    const status = await navigator.permissions.query({ name: 'loopback-network' as PermissionName });
    return status.state;
  } catch { return 'unsupported'; }
}

/** Chrome LNA: declare the address space explicitly; older browsers ignore the option. */
const LOOPBACK_OPTIONS = { targetAddressSpace: 'loopback' } as RequestInit;
export function fetchLocalPrintAgent(
  url: string,
  init: RequestInit = {},
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  return fetchImpl(url, { ...init, ...LOOPBACK_OPTIONS, mode: 'cors' });
}

export interface LocalAgentHealth {
  ok: boolean;
  status?: string;
  version?: string;
  printer?: string;
  engine?: string;
}
export interface PrinterDiagnostics {
  agentVersion: string;
  probe: 'ok' | 'failed' | 'unsupported';
  printerFound: boolean | null;
  printerName: string;
  printerStatus?: string;
  spoolerStatus: string;
  queuedJobs: number | null;
  physicalPrinterStatus: 'unknown';
}
export async function getLocalAgentHealth(timeoutMs = 2500, fetchImpl: FetchLike = fetch): Promise<LocalAgentHealth> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchLocalPrintAgent(`${PRINT_SERVICE_URL}/health`, {
      method: 'GET', signal: controller.signal, cache: 'no-store',
    }, fetchImpl);
    if (!response.ok) throw new Error(`Print Agent health HTTP ${response.status}`);
    const data = await response.json();
    if (data?.ok !== true && data?.status !== 'ok') throw new Error('Invalid print agent health response');
    return data as LocalAgentHealth;
  } finally { clearTimeout(timeout); }
}
export async function getLocalPrinterDiagnostics(): Promise<PrinterDiagnostics> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchLocalPrintAgent(`${PRINT_SERVICE_URL}/diagnostics`, {
      method: 'GET', signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Print diagnostics HTTP ${response.status}`);
    return (await response.json()) as PrinterDiagnostics;
  } finally { clearTimeout(timeout); }
}

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
  | 'PRINT_DISABLED'
  | 'PRINT_TYPE_DISABLED'
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
  receiptType?: 'invoice' | 'expense' | 'deduction' | 'other';
}

const ARABIC_MESSAGES: Record<PrintErrorCode, string> = {
  SERVICE_UNAVAILABLE: 'تعذر الوصول إلى خدمة الطباعة المحلية على هذا الجهاز.',
  NETWORK_ERROR: 'تعذر الاتصال؛ ربما Agent متوقف أو المتصفح منع صلاحية Loopback.',
  CORS_BLOCKED: 'المتصفح منع الاتصال بخدمة الطباعة المحلية (CORS).',
  HTTP_ERROR: 'خدمة الطباعة أعادت خطأ غير متوقع.',
  INVALID_PAYLOAD: 'بيانات الإيصال غير صالحة للطباعة.',
  PRINTER_NOT_FOUND: 'تم الوصول إلى خدمة الطباعة، لكن الطابعة غير متاحة.',
  PRINTER_OFFLINE: 'الطابعة غير متصلة أو في وضع Offline.',
  SPOOLER_ERROR: 'فشل Windows في إرسال المهمة إلى الطابعة. راجع قائمة انتظار الطباعة.',
  PRINT_COMMAND_FAILED: 'فشلت عملية الطباعة داخل خدمة الطباعة المحلية.',
  PRINT_DISABLED: 'الطباعة متوقفة حاليًا من صفحة إدارة الطباعة.',
  PRINT_TYPE_DISABLED: 'تم إيقاف طباعة هذا النوع من الإيصالات من الإعدادات.',
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
    'PRINT_DISABLED',
    'PRINT_TYPE_DISABLED',
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
  timeoutMs = 1500, fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try { return (await getLocalAgentHealth(timeoutMs, fetchImpl)).ok === true; }
  catch { return false; }
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
    const res = await fetchLocalPrintAgent(`${PRINT_SERVICE_URL}/print/html`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({
        html: payload.html,
        width: payload.width ?? '80mm',
        printer: payload.printer ?? 'default',
        receiptType: payload.receiptType ?? 'other',
        requestId,
      }),
      signal: controller.signal,
    }, fetchImpl);

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


export type ReceiptType = 'invoice' | 'expense' | 'deduction' | 'other';

export interface LocalPrinterSettings {
  enabled: boolean;
  version?: string;
  autoCut: boolean;
  types: Record<ReceiptType, boolean>;
  printer: string;
  engine: 'escpos' | 'pdf';
  adapter: string;
  pendingJobs: number;
  activeJobs: number;
  lastAcceptedAt: string | null;
  scope: string;
  physicalPrinterStatus: 'unknown';
}

async function settingsRequest<T>(
  endpoint: string,
  options: { method?: 'GET' | 'PATCH' | 'POST'; body?: object; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 6000);
  try {
    const response = await fetchLocalPrintAgent(PRINT_SERVICE_URL + endpoint, {
      method: options.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok || data?.ok !== true) {
      throw new Error(data?.message || data?.code || 'فشل الاتصال بخدمة الطباعة');
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getLocalPrinterSettings(): Promise<LocalPrinterSettings> {
  return settingsRequest<LocalPrinterSettings>('/settings');
}

export async function patchLocalPrinterSettings(
  update: { enabled?: boolean; autoCut?: boolean; types?: Partial<LocalPrinterSettings['types']> },
): Promise<void> {
  await settingsRequest('/settings', { method: 'PATCH', body: update });
}

export async function printLocalTestReceipt(): Promise<void> {
  await settingsRequest('/print/test', {
    method: 'POST',
    body: { requestId: createPrintRequestId('dashboard-test') },
    timeoutMs: 25000,
  });
}
