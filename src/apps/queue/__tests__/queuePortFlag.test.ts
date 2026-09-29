import { afterEach, describe, expect, it } from 'vitest';
import { getDrvoModuleRolloutSpec } from '@/platform/drvo/moduleManifest';
import { isQueueSchedulingPortEnabled } from '../internal/queuePortFlag';

describe('DRVO-005 queue port flag', () => {
  afterEach(() => {
    delete process.env.QUEUE_SCHEDULING_PORT;
    delete process.env.DRVO_FORCE_QUEUE_PATH;
  });

  it('unset env follows source-controlled queue rollout', () => {
    delete process.env.QUEUE_SCHEDULING_PORT;
    const queue = getDrvoModuleRolloutSpec('queue');
    expect(isQueueSchedulingPortEnabled()).toBe(queue.rollout === 'extracted');
  });

  it('leftover QUEUE_SCHEDULING_PORT=false is ignored and follows manifest', () => {
    const queue = getDrvoModuleRolloutSpec('queue');
    process.env.QUEUE_SCHEDULING_PORT = 'false';
    expect(isQueueSchedulingPortEnabled()).toBe(queue.rollout === 'extracted');

    process.env.QUEUE_SCHEDULING_PORT = 'TRUE';
    expect(isQueueSchedulingPortEnabled()).toBe(queue.rollout === 'extracted');
  });

  it('compat env true remains an extracted break-glass/testing override', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'true';
    expect(isQueueSchedulingPortEnabled()).toBe(true);
  });

  it('DRVO_FORCE_QUEUE_PATH=legacy beats compat true and manifest', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'true';
    process.env.DRVO_FORCE_QUEUE_PATH = 'legacy';
    expect(isQueueSchedulingPortEnabled()).toBe(false);
  });
});
