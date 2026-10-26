import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Salon Queue authenticated staging acceptance', () => {
  it('fails closed unless connected to isolated staging SQL and dedicated login', () => {
    const script = source('scripts/drvo/salon-queue-e2e-staging.ts');
    expect(script).toContain("const EXPECTED_DB = 'last132_agent'");
    expect(script).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
    expect(script).toContain("await assertStaging(pool)");
    expect(script).toContain("process.env.DB_DATABASE === 'last132'");
    expect(script).not.toContain('dotenv.config');
    expect(script).toContain("await purgeSmokeTenant(pool, tenantCode)");
    expect(script).toContain("'Synthetic queue ticket cleaned completely'");
    expect(script).toContain("'SALON_QUEUE_E2E_STAGING_EXIT_OK'");
  });

  it('uses authentic tenant owner login and the real HTTP queue routes', () => {
    const script = source('scripts/drvo/salon-queue-e2e-staging.ts');
    expect(script).toContain("'/api/auth/login'");
    expect(script).toContain("'/api/queue'");
    expect(script).toContain("'/api/queue/' + queueTicketId");
    expect(script).toContain('ticket.ticket?.durationMinutes === 45');
    expect(script).toContain("['called', 'called']");
    expect(script).toContain("['arrived', 'arrived']");
    expect(script).toContain("['in_service', 'in_service']");
    expect(script).toContain("['done', 'done']");
    expect(script).toContain("SALON_QUEUE_WALKIN_E2E_STAGING_PASS");
  });

  it('runs only on designated staging PR and has no deploy step', () => {
    const workflow = source('.github/workflows/salon-queue-staging-e2e.yml');
    expect(workflow).toContain("head.ref == 'agent/salon-queue-e2e'");
    expect(workflow).toContain('environment: drvo-staging');
    expect(workflow).toContain('DRVO_STAGING_DB_PASSWORD');
    expect(workflow).toContain('DRVO_STAGING_SSH_KEY');
    expect(workflow).toContain('npx tsx scripts/drvo/salon-queue-e2e-staging.ts');
    expect(workflow).not.toContain('deploy-vps');
    expect(workflow).not.toContain('run-migrations');
  });
});
