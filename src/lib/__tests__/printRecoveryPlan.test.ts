import { describe, it, expect } from 'vitest';
import { buildPrintRecoveryPlan, type RecoveryContext } from '../printRecoveryPlan';

const context: RecoveryContext = {
  attempted: true, connected: true, permission: 'granted',
  settings: {
    enabled: true, version: '2.0.0', autoCut: true, printer: 'XP-80',
    types: { invoice: true, expense: true, deduction: true, other: true },
    engine: 'escpos', adapter: 'real', pendingJobs: 0, activeJobs: 0,
    lastAcceptedAt: null, scope: 'this-computer', physicalPrinterStatus: 'unknown',
  },
  diagnostics: {
    agentVersion: '2.0.0', probe: 'ok', printerFound: true, printerName: 'XP-80',
    spoolerStatus: 'Running', printerStatus: 'Normal', queuedJobs: 0, physicalPrinterStatus: 'unknown',
  },
};

describe('layered CUT print recovery plan', () => {
  const kind = (patch: Partial<RecoveryContext>) => buildPrintRecoveryPlan({ ...context, ...patch })[0].kind;
  it('starts with a nonprinting, user-gesture check', () => {
    const s = buildPrintRecoveryPlan({ ...context, attempted: false, connected: false })[0];
    expect(s.kind).toBe('check');
    expect(s.action).toBe('check');
  });
  it('prioritizes blocked Chrome permissions over reinstalling Agent', () => {
    expect(kind({ connected: false, permission: 'denied' })).toBe('browser');
  });
  it('distinguishes old Agent version from unreachable Agent', () => {
    expect(kind({ connected: false, healthVersion: '1.1.0' })).toBe('upgrade');
    expect(kind({ connected: false, healthVersion: '2.0.0' })).toBe('settings');
    expect(kind({ connected: false, healthVersion: null })).toBe('agent');
  });
  it('does not offer a print test when print policy is paused', () => {
    expect(kind({ settings: { ...context.settings!, enabled: false } })).toBe('settings');
  });
  it('prioritizes stopped Windows spooler and missing printer', () => {
    expect(kind({ diagnostics: { ...context.diagnostics!, spoolerStatus: 'Stopped' } })).toBe('spooler');
    expect(kind({ diagnostics: { ...context.diagnostics!, printerFound: false } })).toBe('printer');
  });
  it('detects offline printer and a nonempty queue without triggering any retry', () => {
    expect(kind({ diagnostics: { ...context.diagnostics!, printerStatus: 'Offline' } })).toBe('printer');
    expect(kind({ diagnostics: { ...context.diagnostics!, queuedJobs: 3 } })).toBe('queue');
  });
  it('distinguishes unavailable Windows diagnostics from ready-but-unverified hardware', () => {
    expect(kind({ diagnostics: null })).toBe('verify');
    expect(kind({ diagnostics: { ...context.diagnostics!, spoolerStatus: 'unknown' } })).toBe('verify');
    expect(kind({ diagnostics: { ...context.diagnostics!, printerFound: null } })).toBe('verify');
    expect(kind({ diagnostics: { ...context.diagnostics!, printerStatus: 'unknown' } })).toBe('verify');
    const stage = buildPrintRecoveryPlan(context)[0];
    expect(stage.kind).toBe('ready');
    expect(stage.detail).toContain('لا يثبت خروج الورقة');
    expect(stage.action).toBe('test');
  });
});
