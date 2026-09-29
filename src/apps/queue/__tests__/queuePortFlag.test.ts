import { afterEach, describe, expect, it } from 'vitest';
import { isQueueSchedulingPortEnabled } from '../internal/queuePortFlag';

describe('DRVO-005 queue port flag', () => {
  afterEach(() => {
    delete process.env.QUEUE_SCHEDULING_PORT;
  });

  it('defaults to legacy when unset', () => {
    delete process.env.QUEUE_SCHEDULING_PORT;
    expect(isQueueSchedulingPortEnabled()).toBe(false);
  });

  it('legacy when false or malformed', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'false';
    expect(isQueueSchedulingPortEnabled()).toBe(false);
    process.env.QUEUE_SCHEDULING_PORT = 'TRUE';
    expect(isQueueSchedulingPortEnabled()).toBe(false);
  });

  it('extracted only when QUEUE_SCHEDULING_PORT=true', () => {
    process.env.QUEUE_SCHEDULING_PORT = 'true';
    expect(isQueueSchedulingPortEnabled()).toBe(true);
  });
});
