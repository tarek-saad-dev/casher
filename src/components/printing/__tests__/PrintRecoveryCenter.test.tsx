import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PrintRecoveryCenter from '../PrintRecoveryCenter';

const noop = () => {};
describe('guided print recovery UI', () => {
  it('offers a nonprinting first check', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted={false} connected={false}
      permission="prompt" busy={false} onCheck={noop} onTest={noop} onEnable={noop} />);
    expect(html).toContain('مركز إصلاح الطباعة');
    expect(html).toContain('فحص الاتصال');
    expect(html).not.toContain('إرسال ورقة اختبار واحدة');
  });
  it('offers the local restart checker when Agent is unavailable', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted connected={false}
      permission="unsupported" busy={false} onCheck={noop} onTest={noop} onEnable={noop} />);
    expect(html).toContain('/downloads/Check-CUT-Print-Agent.ps1');
    expect(html).not.toContain('/print/test');
  });
  it('offers repair instead of a blind repeat for outdated Agent', () => {
    const html = renderToStaticMarkup(<PrintRecoveryCenter attempted connected={false}
      permission="granted" healthVersion="1.1.0" busy={false} onCheck={noop} onTest={noop} onEnable={noop} />);
    expect(html).toContain('/downloads/Install-CUT-Print-Agent.ps1');
  });
});
