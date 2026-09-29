import { afterEach, describe, expect, it } from 'vitest';
import { isQueueSchedulingPortEnabled } from '../internal/queuePortFlag';

describe('DRVO-005 queue port flag', () => {
  afterEach(() => {
    delete process.env.QUEUE_SCHEDULING_PORT;
    delete process.env.DRVO_FORCE_QUEUE_PATH;
  });

  it('source-controlled rollout=legacy when env unset', () => {
    delete process.env.QUEUE_SCHEDULING_PORT;
    expect(isQueueSchedulingPortEnabled()).toBe(false);
  });

  it('leftover QUEUE_SCHEDULING_PORT=false stays legacy via manifest', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'false';
    expect(isQueueSchedulingPortEnabled()).toBe(false);
    process.env.QUEUE_SCHEDULING_PORT = 'TRUE';
    expect(isQueueSchedulingPortEnabled()).toBe(false);
  });

  it('compat env true is break-glass extracted override only', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'true';
    expect(isQueueSchedulingPortEnabled()).toBe(true);
  });

  it('DRVO_FORCE_QUEUE_PATH=legacy beats compat true', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'true';
    process.env.DRVO_FORCE_QUEUE_PATH = 'legacy';
    expect(isQueueSchedulingPortEnabled()).toBe(false);
  });
});
