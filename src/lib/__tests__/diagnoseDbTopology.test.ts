import { describe, it, expect } from 'vitest';
import { classifyDbPathKindForDiagnostics, diagnoseDbTopology } from '@/lib/db/diagnoseDbTopology';

describe('diagnoseDbTopology', () => {
  it('classifies forwarded dev loopback port as tunnel path', () => {
    const prev = { ...process.env };
    process.env.HAWAI_DB_CLASS = 'local';
    process.env.LOCAL_DB_SERVER = '127.0.0.1';
    process.env.LOCAL_DB_PORT = '14330';
    process.env.DB_SERVER = '127.0.0.1';
    process.env.DB_PORT = '14330';
    process.env.LOCAL_DB_NAME = 'last132';
    process.env.NODE_ENV = 'development';

    const report = diagnoseDbTopology();
    expect(report.effectiveConfig.pathKind).toBe('loopback_forwarded');
    expect(report.interpretation.isDeveloperTunnelPath).toBe(true);

    process.env = prev;
  });

  it('flags public same-host SQL path on VPS', () => {
    expect(classifyDbPathKindForDiagnostics('187.77.75.79', 1433, ['187.77.75.79'])).toBe(
      'public_same_host',
    );
  });
});
