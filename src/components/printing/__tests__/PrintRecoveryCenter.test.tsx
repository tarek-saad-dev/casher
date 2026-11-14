import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PrintRecoveryCenter from '../PrintRecoveryCenter';

const noop = () => {};
describe('guided print recovery UI', () => {
  it('offers matching Chrome repair download when Puppeteer Chrome is missing', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted connected permission="granted"
      busy={false} onCheck={noop} onTest={noop} onEnable={noop} onEnableTest={noop}
      settings={{
        enabled: true, version: '2.0.0', autoCut: true,
        types: { invoice: true, expense: true, deduction: true, other: true },
        printer: 'XP-80', engine: 'escpos', adapter: 'real', pendingJobs: 0, activeJobs: 0,
        lastAcceptedAt: null, scope: 'this-computer', physicalPrinterStatus: 'unknown',
      }}
      diagnostics={{
        browserFound: false, agentVersion: '2.0.0', probe: 'ok',
        printerFound: true, printerName: 'XP-80', printerStatus: 'Normal',
        spoolerStatus: 'Running', queuedJobs: 0, physicalPrinterStatus: 'unknown',
      }}
    />);
    expect(html).toContain('data-testid="repair-puppeteer-chrome"');
    expect(html).toContain('href="/downloads/Repair-CUT-Print-Chrome.cmd"');
    expect(html).toContain('download="Repair-CUT-Print-Chrome.cmd"');
    const asset = readFileSync(join(process.cwd(), 'public/downloads/Repair-CUT-Print-Chrome.cmd'), 'utf8');
    expect(asset).toContain('npx.cmd --no-install puppeteer browsers install chrome');
    expect(asset).toContain('node.exe -e');
    expect(asset).not.toContain('Set-ExecutionPolicy');
  });
  it('offers a nonprinting first check', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted={false} connected={false}
      permission="prompt" busy={false} onCheck={noop} onTest={noop} onEnable={noop} onEnableTest={noop} />);
    expect(html).toContain('مركز إصلاح الطباعة');
    expect(html).toContain('فحص الاتصال');
    expect(html).not.toContain('إرسال ورقة اختبار واحدة');
  });
  it('offers the local restart checker when Agent is unavailable', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted connected={false}
      permission="unsupported" busy={false} onCheck={noop} onTest={noop} onEnable={noop} onEnableTest={noop} />);
    expect(html).toContain('/downloads/Check-CUT-Print-Agent.ps1');
    expect(html).not.toContain('/print/test');
  });
  it('offers repair instead of a blind repeat for outdated Agent', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted connected={false}
      permission="granted" healthVersion="1.1.0" busy={false} onCheck={noop} onTest={noop} onEnable={noop} onEnableTest={noop} />);
    expect(html).toContain('/downloads/Install-CUT-Print-Agent.ps1');
  });
});
