import { afterEach, describe, expect, it } from 'vitest';
import { getDrvoModuleRolloutSpec } from '@/platform/drvo/moduleManifest';
import { isPosPortEnabled } from '../internal/posPortFlag';

describe('DRVO-008 POS port flag', () => {
  afterEach(() => {
    delete process.env.POS_SCHEDULING_PORT;
    delete process.env.DRVO_FORCE_POS_PATH;
  });

  it('follows manifest rollout when env overrides are unset', () => {
    const pos = getDrvoModuleRolloutSpec('pos');
    expect(isPosPortEnabled()).toBe(pos.rollout === 'extracted');
  });

  it('compat env true forces extracted for staging tests', () => {
    process.env.POS_SCHEDULING_PORT = 'true';
    expect(isPosPortEnabled()).toBe(true);
  });

  it('DRVO_FORCE_POS_PATH wins over compat env', () => {
    process.env.POS_SCHEDULING_PORT = 'true';
    process.env.DRVO_FORCE_POS_PATH = 'legacy';
    expect(isPosPortEnabled()).toBe(false);
  });
});
