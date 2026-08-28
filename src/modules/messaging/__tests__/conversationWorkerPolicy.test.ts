import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INBOX_IDLE_MAX_MS,
  DEFAULT_INBOX_BATCH_SIZE,
  nextIdleDelayMs,
} from '@/modules/messaging/conversation/workerPolicy';
import { categorizeDbHost } from '@/lib/db/benchmarkDbLatency';

describe('conversation inbox workerPolicy', () => {
  it('defaults batch size to 1 for latency-first processing', () => {
    expect(DEFAULT_INBOX_BATCH_SIZE).toBe(1);
  });

  it('uses zero delay when recently active', () => {
    expect(nextIdleDelayMs(25, 150, 3, true)).toBe(0);
  });

  it('backs off when idle', () => {
    expect(nextIdleDelayMs(25, DEFAULT_INBOX_IDLE_MAX_MS, 1, false)).toBe(25);
    expect(nextIdleDelayMs(25, DEFAULT_INBOX_IDLE_MAX_MS, 4, false)).toBe(150);
  });
});

describe('categorizeDbHost', () => {
  it('classifies loopback hosts', () => {
    expect(categorizeDbHost('127.0.0.1')).toBe('loopback');
    expect(categorizeDbHost('localhost')).toBe('loopback');
  });

  it('classifies azure sql hosts', () => {
    expect(categorizeDbHost('myserver.database.windows.net')).toBe('azure_sql');
  });
});
