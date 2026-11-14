import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PRINT_SERVICE_URL,
  checkLocalPrintServiceHealth,
  createPrintRequestId,
  printHtmlViaLocalService,
  userMessageForCode,
  getLocalPrinterSettings,
  patchLocalPrinterSettings,
} from '@/lib/localPrintClient';

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

describe('localPrintClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('createPrintRequestId keeps a stable prefix and unique suffix', () => {
    const a = createPrintRequestId('exp-12');
    const b = createPrintRequestId('exp-12');
    expect(a.startsWith('exp-12-')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('supports printer policy errors without suggesting an automatic browser fallback', async () => {
    const fetchImpl: FetchLike = vi.fn(async url => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(409, {
        ok: false,
        requestId: 'blocked-expense',
        stage: 'settings',
        code: 'PRINT_TYPE_DISABLED',
        message: 'Receipt type paused',
      });
    });
    const result = await printHtmlViaLocalService(
      { html: '<html>Expense</html>', receiptType: 'expense', requestId: 'blocked-expense' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PRINT_TYPE_DISABLED');
      expect(result.userMessage).toContain('إيقاف');
    }
    const sent = JSON.parse(String((fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1][1]?.body));
    expect(sent.receiptType).toBe('expense');
  });

  it('reads and updates printer controls from the same local agent', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe(`${PRINT_SERVICE_URL}/settings`);
      if (init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toEqual({ types: { invoice: false } });
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(200, {
        ok: true, enabled: true, autoCut: true,
        types: { invoice: true, expense: true, deduction: true, other: true },
        printer: 'XP-80', engine: 'escpos', adapter: 'real',
        activeJobs: 0, pendingJobs: 0, lastAcceptedAt: null,
        scope: 'this-computer', physicalPrinterStatus: 'unknown',
      });
    });
    const result = await getLocalPrinterSettings();
    expect(result.engine).toBe('escpos');
    await patchLocalPrinterSettings({ types: { invoice: false } });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('userMessageForCode returns Arabic diagnostics', () => {
    expect(userMessageForCode('SERVICE_UNAVAILABLE')).toContain('خدمة الطباعة');
    expect(userMessageForCode('PRINTER_NOT_FOUND', 'XP-80')).toContain('XP-80');
    expect(userMessageForCode('SPOOLER_ERROR')).toContain('قائمة انتظار');
  });

  it('checkLocalPrintServiceHealth returns true on ok health', async () => {
    const fetchImpl: FetchLike = vi.fn().mockResolvedValue(jsonResponse(200, { status: 'ok' }));
    await expect(checkLocalPrintServiceHealth(1000, fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${PRINT_SERVICE_URL}/health`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('checkLocalPrintServiceHealth returns false on network failure', async () => {
    const fetchImpl: FetchLike = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(checkLocalPrintServiceHealth(1000, fetchImpl)).resolves.toBe(false);
  });

  it('printHtmlViaLocalService posts to /print/html with correct payload', async () => {
    const requestId = 'exp-test-001';
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      if (String(url).endsWith('/health')) {
        return jsonResponse(200, { status: 'ok' });
      }
      expect(String(url)).toBe(`${PRINT_SERVICE_URL}/print/html`);
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        html: '<html>expense</html>',
        width: '58mm',
        printer: 'default',
        requestId,
      });
      return jsonResponse(200, {
        ok: true,
        success: true,
        printer: 'XP-80',
        requestId,
        message: 'HTML printed successfully',
      });
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>expense</html>', requestId, width: '58mm' },
      { fetchImpl },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.printer).toBe('XP-80');
      expect(result.requestId).toBe(requestId);
    }
  });

  it('treats 200 + ok:true as success and does not invent browser fallback', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(200, { ok: true, success: true, printer: 'XP-80', requestId: 'r1' });
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId: 'r1' },
      { fetchImpl },
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('shows missing Chrome renderer instead of wrongly blaming Windows printer', async () => {
    const fetchImpl: FetchLike = vi.fn(async url => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(500, {
        ok: false, code: 'BROWSER_MISSING', stage: 'rendering',
        message: 'Could not find Chrome (ver. 148.0.7778.97).',
      });
    });
    const result = await printHtmlViaLocalService(
      { html: '<html><body>CUT</body></html>', requestId: 'missing-chrome-test' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BROWSER_MISSING');
      expect(result.userMessage).toContain('Chrome');
    }
  });

  it('recognizes missing Puppeteer Chrome even when a legacy Agent mislabels the error as printer not found', async () => {
    const fetchImpl: FetchLike = vi.fn(async url => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(500, {
        ok: false,
        code: 'PRINTER_NOT_FOUND',
        message: 'Could not find Chrome (ver. 148.0.7778.97).',
      });
    });
    const result = await printHtmlViaLocalService(
      { html: '<html>receipt</html>', requestId: 'legacy-chrome-error' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BROWSER_MISSING');
      expect(result.userMessage).toContain('Chrome');
    }
  });

  it('does not offer Chrome repair for actual Windows printer-not-found messages', async () => {
    const fetchImpl: FetchLike = vi.fn(async url => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(500, {
        ok: false,
        code: 'PRINTER_NOT_FOUND',
        message: 'Could not find printer XP-80',
      });
    });
    const result = await printHtmlViaLocalService(
      { html: '<html>receipt</html>', requestId: 'real-printer-error' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PRINTER_NOT_FOUND');
  });

  it('handles 500 structured error', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return jsonResponse(500, {
        ok: false,
        stage: 'spooler',
        code: 'SPOOLER_ERROR',
        message: 'Spooler failed',
        requestId: 'r2',
        printer: 'XP-80',
      });
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId: 'r2' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SPOOLER_ERROR');
      expect(result.userMessage).toContain('قائمة انتظار');
      expect(result.requestId).toBe('r2');
    }
  });

  it('handles invalid JSON body', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      return {
        ok: true,
        status: 200,
        text: async () => 'not-json',
      } as Response;
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId: 'r3' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('HTTP_ERROR');
  });

  it('handles timeout / AbortError', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId: 'r4' },
      { fetchImpl, timeoutMs: 10 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('TIMEOUT');
  });

  it('handles Failed to fetch as NETWORK_ERROR after healthy check', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      throw new TypeError('Failed to fetch');
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId: 'r5' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('NETWORK_ERROR');
  });

  it('returns SERVICE_UNAVAILABLE when health fails and does not POST print', async () => {
    const fetchImpl: FetchLike = vi.fn(async (url) => {
      if (String(url).endsWith('/health')) throw new TypeError('Failed to fetch');
      throw new Error('should not print');
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId: 'r6' },
      { fetchImpl },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SERVICE_UNAVAILABLE');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the provided requestId across the attempt', async () => {
    const requestId = 'fixed-id-abc';
    const fetchImpl: FetchLike = vi.fn(async (url, init) => {
      if (String(url).endsWith('/health')) return jsonResponse(200, { status: 'ok' });
      const headers = init?.headers as Record<string, string>;
      expect(headers['X-Request-Id']).toBe(requestId);
      const body = JSON.parse(String(init?.body));
      expect(body.requestId).toBe(requestId);
      return jsonResponse(200, { ok: true, success: true, requestId });
    });

    const result = await printHtmlViaLocalService(
      { html: '<html>x</html>', requestId },
      { fetchImpl },
    );
    expect(result.requestId).toBe(requestId);
  });
});
