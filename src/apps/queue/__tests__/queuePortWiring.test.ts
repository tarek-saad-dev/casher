import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('DRVO-005 queue port wiring', () => {
  it('operations queue create uses extracted port when flag is on', () => {
    const route = read('src/app/api/operations/queue/create/route.ts');
    expect(route).toContain('isQueueSchedulingPortEnabled');
    expect(route).toContain('createQueueTicket');
    expect(route).toContain('queuePortHooks');
  });

  it('operations queue cancel uses extracted port when flag is on', () => {
    const route = read('src/app/api/operations/queue/[id]/cancel/route.ts');
    expect(route).toContain('isQueueSchedulingPortEnabled');
    expect(route).toContain('cancelQueueTicket');
    expect(route).toContain('queuePortHooks');
  });

  it('quick queue passes port hooks for any-barber lock', () => {
    const route = read('src/app/api/operations/queue/quick/route.ts');
    expect(route).toContain('isQueueSchedulingPortEnabled');
    expect(route).toContain('queuePortHooks');
    expect(route).toContain("reason === 'lock_timeout'");
    expect(route).toContain('BookingCreateLockError');
  });

  it('quick queue holds the booking any-barber key on the insert transaction', () => {
    const src = read('src/lib/operationsQueueCreateCore.ts');
    const fn = src.slice(src.indexOf('export async function executeQuickQueueOperation'));
    expect(fn).toContain('hashServiceSet(serviceIds)');
    expect(fn).not.toContain('quick-queue:');
    const lockAt = fn.indexOf('bridgeQueueAcquireAnyBarberLock');
    const selectAt = fn.indexOf('planQuickQueueAssignment(', lockAt);
    const createAt = fn.indexOf('joinTransaction: tx', selectAt);
    const commitAt = fn.indexOf('await tx.commit()', createAt);
    expect(lockAt).toBeGreaterThan(0);
    expect(selectAt).toBeGreaterThan(lockAt);
    expect(createAt).toBeGreaterThan(selectAt);
    expect(commitAt).toBeGreaterThan(createAt);
    expect(fn).not.toMatch(/bridgeQueueAcquireAnyBarberLock[\s\S]{0,500}await tx\.commit\(\);\s*\} catch/);
  });

  it('extracted create routes a phone through the customers port before any legacy client insert', () => {
    const src = read('src/lib/operationsQueueCreateCore.ts');
    const fn = src.slice(
      src.indexOf('export async function createOperationsQueueTicket'),
      src.indexOf('export async function resolveQuickQueueService'),
    );
    const portAt = fn.indexOf('assignQueueCustomerThroughPort');
    const legacyAt = fn.indexOf('INSERT INTO [dbo].[TblClient]');
    expect(portAt).toBeGreaterThan(0);
    expect(legacyAt).toBeGreaterThan(portAt);
    expect(fn).toContain('customer?.phone?.trim() && portCtx.queuePortHooks');
  });
});
