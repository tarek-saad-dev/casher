import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PrintAgentInstallerDownload, { PRINT_AGENT_V2_SETUP_FILE } from '../PrintAgentInstallerDownload';

describe('CUT Print Agent V2 Windows installer download', () => {
  it('always provides a real same-origin CMD download and clear single-PC instructions', () => {
    const markup = renderToStaticMarkup(<PrintAgentInstallerDownload />);
    expect(PRINT_AGENT_V2_SETUP_FILE).toBe('/downloads/CUT_Salon_Print_Agent_V2_Setup.cmd');
    expect(markup).toContain('data-testid="print-agent-v2-installer-download"');
    expect(markup).toContain('href="/downloads/CUT_Salon_Print_Agent_V2_Setup.cmd"');
    expect(markup).toContain('download="CUT_Salon_Print_Agent_V2_Setup.cmd"');
    expect(markup).toContain('بدبل كليك');
    expect(markup).toContain('Windows');
    expect(markup).toContain('Node.js 22');
    expect(markup).not.toContain('onClick');
  });
});
