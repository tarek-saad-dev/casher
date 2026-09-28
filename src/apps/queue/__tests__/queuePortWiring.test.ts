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
  });
});
