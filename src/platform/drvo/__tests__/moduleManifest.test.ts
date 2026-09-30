import fs from 'fs';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  isDrvoModuleExtractedPathEnabled,
  isStrictOptInEnvFlag,
  resolveDrvoModuleRollout,
} from '../featureFlags';
import {
  assertAllDrvoRolloutContracts,
  assertExtractedRolloutContract,
  DRVO_MODULE_ROLLOUT,
  getDrvoModuleRolloutSpec,
  type DrvoModuleRolloutSpec,
} from '../moduleManifest';

describe('DRVO module rollout manifest', () => {
  afterEach(() => {
    delete process.env.BOOKING_SCHEDULING_PORT;
    delete process.env.QUEUE_SCHEDULING_PORT;
    delete process.env.POS_SCHEDULING_PORT;
    delete process.env.POS_SALE_TREASURY_PORT;
    delete process.env.DRVO_FORCE_BOOKING_PATH;
    delete process.env.DRVO_FORCE_QUEUE_PATH;
    delete process.env.DRVO_FORCE_POS_PATH;
    delete process.env.DRVO_FORCE_POS_SALE_TREASURY_PATH;
  });

  it('uses extracted booking and queue for this rollout', () => {
    const booking = getDrvoModuleRolloutSpec('booking');
    const queue = getDrvoModuleRolloutSpec('queue');
    expect(booking.rollout).toBe('extracted');
    expect(queue.rollout).toBe('extracted');
    expect(booking.classification).toBe('extracted');
    expect(queue.classification).toBe('extracted');
    expect(booking.compatEnvFlag).toBe('BOOKING_SCHEDULING_PORT');
    expect(queue.compatEnvFlag).toBe('QUEUE_SCHEDULING_PORT');
    expect(booking.forcePathEnv).toBe('DRVO_FORCE_BOOKING_PATH');
    expect(queue.forcePathEnv).toBe('DRVO_FORCE_QUEUE_PATH');
  });

  it('classifies already-proven calendar/treasury as always-on extracted', () => {
    const calendar = getDrvoModuleRolloutSpec('operational-calendar');
    const treasury = getDrvoModuleRolloutSpec('treasury');
    expect(calendar.rollout).toBe('extracted');
    expect(treasury.rollout).toBe('extracted');
    expect(calendar.classification).toBe('always_on_infrastructure');
    expect(treasury.classification).toBe('always_on_infrastructure');
  });

  it('rejects incomplete extracted rollout contracts (future DRVO-008+ gate)', () => {
    expect(() => assertAllDrvoRolloutContracts()).not.toThrow();
    const incomplete: DrvoModuleRolloutSpec = {
      module: 'future-app',
      drvoId: 'DRVO-008',
      rollout: 'extracted',
      classification: 'extracted',
      classificationRationale: 'test',
      requiredMigrationKeys: [],
      dependencies: [],
      readinessCheckIds: [],
      rollbackRollout: 'legacy',
    };
    expect(() => assertExtractedRolloutContract(incomplete)).toThrow(/incomplete contract/);
  });

  it('strict opt-in helper only accepts literal true', () => {
    expect(isStrictOptInEnvFlag(undefined)).toBe(false);
    expect(isStrictOptInEnvFlag('')).toBe(false);
    expect(isStrictOptInEnvFlag('false')).toBe(false);
    expect(isStrictOptInEnvFlag('TRUE')).toBe(false);
    expect(isStrictOptInEnvFlag('true')).toBe(true);
  });

  it('deploy uses central drvo migrate and verify before restart (no env flag mutation)', () => {
    const deploy = fs.readFileSync(path.join(process.cwd(), 'deploy/deploy-casher'), 'utf8');
    const migrate = deploy.indexOf('npm run drvo:migrate-production');
    const verify = deploy.indexOf('npm run drvo:verify');
    const restart = deploy.indexOf('systemctl restart casher');
    expect(migrate).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(migrate);
    expect(restart).toBeGreaterThan(verify);
    expect(deploy).not.toContain('treasury:migrate-drvo-007');
    expect(deploy).not.toContain('BOOKING_SCHEDULING_PORT=true');
    expect(deploy).not.toContain('QUEUE_SCHEDULING_PORT=true');
  });

  it('booking port uses source-controlled resolver (not env-only)', () => {
    const flag = fs.readFileSync(
      path.join(process.cwd(), 'src/apps/booking/internal/schedulingPortFlag.ts'),
      'utf8',
    );
    expect(flag).toContain('isDrvoModuleExtractedPathEnabled');
    expect(flag).not.toContain("!== 'false'");
  });
});

describe('DRVO rollout resolver precedence', () => {
  const booking = () => getDrvoModuleRolloutSpec('booking');

  it('unset env follows manifest booking rollout', () => {
    const env = {};
    expect(resolveDrvoModuleRollout(booking(), env)).toEqual({
      effective: booking().rollout,
      source: 'manifest',
      module: 'booking',
    });
    expect(isDrvoModuleExtractedPathEnabled('booking', env)).toBe(booking().rollout === 'extracted');
  });

  it('ignores leftover BOOKING_SCHEDULING_PORT=false and follows manifest', () => {
    const env = { BOOKING_SCHEDULING_PORT: 'false' };
    expect(resolveDrvoModuleRollout(booking(), env).effective).toBe(booking().rollout);
    expect(resolveDrvoModuleRollout(booking(), env).source).toBe('manifest');

    const extractedSpec = { ...booking(), rollout: 'extracted' as const };
    expect(resolveDrvoModuleRollout(extractedSpec, env)).toEqual({
      effective: 'extracted',
      source: 'manifest',
      module: 'booking',
    });
  });

  it('compat env true forces extracted for testing even when manifest is legacy', () => {
    const env = { BOOKING_SCHEDULING_PORT: 'true' };
    expect(resolveDrvoModuleRollout(booking(), env)).toEqual({
      effective: 'extracted',
      source: 'compat-env-true',
      module: 'booking',
    });
  });

  it('DRVO_FORCE_BOOKING_PATH wins over compat env and manifest', () => {
    const env = {
      BOOKING_SCHEDULING_PORT: 'true',
      DRVO_FORCE_BOOKING_PATH: 'legacy',
    };
    expect(resolveDrvoModuleRollout(booking(), env)).toEqual({
      effective: 'legacy',
      source: 'force-env',
      module: 'booking',
    });

    const extractedSpec = { ...booking(), rollout: 'extracted' as const };
    expect(
      resolveDrvoModuleRollout(extractedSpec, {
        BOOKING_SCHEDULING_PORT: 'false',
        DRVO_FORCE_BOOKING_PATH: 'legacy',
      }).effective,
    ).toBe('legacy');
  });

  it('malformed compat values defer to manifest', () => {
    for (const value of ['TRUE', '1', ' yes', 'true ', 'False']) {
      expect(
        resolveDrvoModuleRollout(booking(), { BOOKING_SCHEDULING_PORT: value }).source,
      ).toBe('manifest');
    }
  });

  it('declares all DRVO modules in the rollout table', () => {
    expect(DRVO_MODULE_ROLLOUT.map((m) => m.module).sort()).toEqual([
      'booking',
      'operational-calendar',
      'pos',
      'pos-sale-treasury',
      'queue',
      'treasury',
    ]);
  });

  it('keeps pos-sale-treasury on legacy until migration + activation', () => {
    const saleTreasury = getDrvoModuleRolloutSpec('pos-sale-treasury');
    expect(saleTreasury.drvoId).toBe('DRVO-009');
    expect(saleTreasury.rollout).toBe('legacy');
    expect(saleTreasury.requiredMigrationKeys).toContain('ins-cash-move-sales-guard');
  });

  it('uses extracted POS rollout after human activation PR', () => {
    const pos = getDrvoModuleRolloutSpec('pos');
    expect(pos.drvoId).toBe('DRVO-008');
    expect(pos.rollout).toBe('extracted');
    expect(pos.forcePathEnv).toBe('DRVO_FORCE_POS_PATH');
    expect(pos.compatEnvFlag).toBe('POS_SCHEDULING_PORT');
    expect(pos.requiredMigrationKeys).not.toContain('pos-prerequisites');
    expect(pos.readinessCheckIds).not.toContain('migration.pos-prerequisites');
  });
});
