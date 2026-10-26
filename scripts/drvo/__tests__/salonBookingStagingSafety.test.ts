import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('Salon booking staging acceptance safety', () => {
  it('requires the staging database and dedicated login before loading mutating modules', () => {
    const source = read('scripts/drvo/salon-booking-e2e-staging.ts');
    expect(source).toContain("const EXPECTED_DB = 'last132_agent'");
    expect(source).toContain("const EXPECTED_LOGIN = 'drvo_agent'");
    expect(source).toContain("await assertStaging(pool);");
    expect(source).toContain("process.env.DB_DATABASE === 'last132'");
    expect(source).toContain("process.env.CLOUD_DB_NAME === 'last132'");
    expect(source).not.toContain("dotenv.config");
    expect(source).toContain("purgeSmokeTenant(pool, tenantCode)");
    expect(source).toContain("customer: { name: 'Salon Acceptance Client'");
  });

  it('silences both customer and group booking notifications in smoke mode', () => {
    const source = read('src/lib/booking/publicBookingCreate.ts');
    expect(source).toMatch(/if \(!input\.suppressNotification\)\s*\{\s*scheduleBookingTeamGroupNotify\(/);
    expect(source).toContain('!input.suppressNotification &&');
    const smoke = read('scripts/drvo/salon-booking-e2e-staging.ts');
    expect(smoke).toContain('suppressNotification: true');
  });

  it('does not run a staging job on arbitrary PR branches or invoke deploy workflows', () => {
    const workflow = read('.github/workflows/salon-booking-staging-e2e.yml');
    expect(workflow).toContain("github.event.pull_request.head.ref == 'agent/salon-booking-e2e'");
    expect(workflow).toContain('environment: drvo-staging');
    expect(workflow).toContain('DRVO_STAGING_SSH_KEY');
    expect(workflow).toContain('DRVO_STAGING_DB_PASSWORD');
    expect(workflow).not.toContain('npm run drvo:migrate-production');
    expect(workflow).not.toContain('deploy-vps');
    expect(workflow).toContain('npx tsx scripts/drvo/salon-booking-e2e-staging.ts');
  });
});
