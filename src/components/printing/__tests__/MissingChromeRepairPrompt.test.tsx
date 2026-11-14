import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import MissingChromeRepairPrompt, {
  CHROME_REPAIR_DOWNLOAD,
  shouldShowChromeRepair,
} from '../MissingChromeRepairPrompt';
import type { PrintErrorCode } from '@/lib/localPrintClient';

describe('show Chrome repair only for the exact missing renderer error', () => {
  it('shows a real one-click Windows download for BROWSER_MISSING', () => {
    expect(shouldShowChromeRepair('BROWSER_MISSING')).toBe(true);
    const html = renderToStaticMarkup(<MissingChromeRepairPrompt errorCode="BROWSER_MISSING" />);
    expect(html).toContain('data-testid="missing-chrome-print-repair"');
    expect(html).toContain('href="/downloads/Repair-CUT-Print-Chrome.cmd"');
    expect(html).toContain('download="Repair-CUT-Print-Chrome.cmd"');
    expect(html).toContain('بدبل كليك');
    expect(html).toContain('ورقة اختبار واحدة');
    const actualDownload = readFileSync(join(process.cwd(), 'public', CHROME_REPAIR_DOWNLOAD.slice(1)), 'utf8');
    expect(actualDownload).toContain('npx.cmd --no-install puppeteer browsers install chrome');
  });

  it.each([
    null,
    'PRINTER_NOT_FOUND',
    'PRINTER_OFFLINE',
    'NETWORK_ERROR',
    'CORS_BLOCKED',
    'SERVICE_UNAVAILABLE',
    'PRINT_COMMAND_FAILED',
    'UNKNOWN',
  ] as Array<PrintErrorCode | null>)('stays completely hidden for %s', (errorCode) => {
    expect(shouldShowChromeRepair(errorCode)).toBe(false);
    const html = renderToStaticMarkup(<MissingChromeRepairPrompt errorCode={errorCode} />);
    expect(html).toBe('');
  });
});
