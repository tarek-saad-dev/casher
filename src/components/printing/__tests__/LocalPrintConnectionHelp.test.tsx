import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import LocalPrintConnectionHelp, { isLocalAgentConnectionError } from '../LocalPrintConnectionHelp';

describe('local print agent guided recovery', () => {
  it('covers local connection failures, but not printing-policy or printer-hardware errors', () => {
    for (const code of ['SERVICE_UNAVAILABLE', 'NETWORK_ERROR', 'CORS_BLOCKED', 'TIMEOUT'] as const) {
      expect(isLocalAgentConnectionError(code)).toBe(true);
    }
    for (const code of ['PRINT_DISABLED', 'PRINT_TYPE_DISABLED', 'PRINTER_OFFLINE', 'SPOOLER_ERROR', 'PRINTER_NOT_FOUND'] as const) {
      expect(isLocalAgentConnectionError(code)).toBe(false);
    }
    expect(isLocalAgentConnectionError(null)).toBe(false);
  });

  it('shows three on-screen actions and a health-only check instead of retrying a print', () => {
    const markup = renderToStaticMarkup(<LocalPrintConnectionHelp />);
    expect(markup).toContain('حلها في 3 خطوات');
    expect(markup).toContain('Task Scheduler');
    expect(markup).toContain('CUT Salon Print Agent');
    expect(markup).toContain('فحص الاتصال');
    expect(markup).toContain('مش هيطبع ورق');
    expect(markup).toContain('http://127.0.0.1:7788/health');
    expect(markup).toContain('إعدادات الطباعة');
    expect(markup).toContain('data-testid="local-print-help"');
    expect(markup).not.toContain('window.print');
  });

  it('shows a compact guide inside a sales receipt dialog without requiring system changes', () => {
    const markup = renderToStaticMarkup(<LocalPrintConnectionHelp compact errorCode="SERVICE_UNAVAILABLE" />);
    expect(markup).toContain('فحص الاتصال');
    expect(markup).toContain('Task Scheduler');
    expect(markup).not.toContain('أو انسخ أمر التشغيل في PowerShell');
  });
});
