import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { isStrictOptInEnvFlag } from '../featureFlags';
import { DRVO_MODULE_ROLLOUT } from '../moduleManifest';

describe('DRVO module rollout manifest', () => {
  it('booking and queue require strict opt-in flags', () => {
    const booking = DRVO_MODULE_ROLLOUT.find((m) => m.module === 'booking')!;
    const queue = DRVO_MODULE_ROLLOUT.find((m) => m.module === 'queue')!;
    expect(booking.strictOptIn).toBe(true);
    expect(booking.rolloutFlagEnv).toBe('BOOKING_SCHEDULING_PORT');
    expect(queue.strictOptIn).toBe(true);
    expect(queue.rolloutFlagEnv).toBe('QUEUE_SCHEDULING_PORT');
  });

  it('strict opt-in only accepts literal true', () => {
    expect(isStrictOptInEnvFlag(undefined)).toBe(false);
    expect(isStrictOptInEnvFlag('')).toBe(false);
    expect(isStrictOptInEnvFlag('false')).toBe(false);
    expect(isStrictOptInEnvFlag('TRUE')).toBe(false);
    expect(isStrictOptInEnvFlag('true')).toBe(true);
  });

  it('deploy uses central drvo migrate and verify before restart', () => {
    const deploy = fs.readFileSync(path.join(process.cwd(), 'deploy/deploy-casher'), 'utf8');
    const migrate = deploy.indexOf('npm run drvo:migrate-production');
    const verify = deploy.indexOf('npm run drvo:verify');
    const restart = deploy.indexOf('systemctl restart casher');
    expect(migrate).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(migrate);
    expect(restart).toBeGreaterThan(verify);
    expect(deploy).not.toContain('treasury:migrate-drvo-007');
  });

  it('booking port flag uses strict opt-in helper', () => {
    const flag = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/booking/internal/schedulingPortFlag.ts'),
      'utf8',
    );
    expect(flag).toContain('isStrictOptInEnvFlag');
    expect(flag).not.toContain("!== 'false'");
  });
});
