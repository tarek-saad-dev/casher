import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PrintAgentInstallerDownload, { PRINT_AGENT_V2_SETUP_FILE } from '../PrintAgentInstallerDownload';

describe('CUT Print Agent V2 Windows installer download', () => {
  it('has the actual Windows launcher in public and checks V2 without persistent policy changes', () => {
    const cmd = readFileSync(join(process.cwd(), 'public', PRINT_AGENT_V2_SETUP_FILE.slice(1)), 'utf8');
    expect(cmd).toContain('@echo off');
    expect(cmd).toContain('Install-CUT-Print-Agent.ps1');
    expect(cmd).toContain('tarek-saad-dev/casher/main/public/downloads/Install-CUT-Print-Agent.ps1');
    expect(cmd).toContain('Ensure-PuppeteerChrome');
    expect(cmd).toContain('-ExecutionPolicy Bypass');
    expect(cmd).toContain('http://127.0.0.1:7788/health');
    expect(cmd).toContain('2.0.0');
    expect(cmd).toContain('pause >nul');
    expect(cmd).not.toContain('Set-ExecutionPolicy');
  });

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
