import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeQueueHistoryActorColumn } from '../../../src/lib/queue/queueTicketHistoryActor';

const file = (name: string) => fs.readFileSync(path.join(process.cwd(), name), 'utf8');

describe('Salon queue — legacy history writer compatibility', () => {
  it('accepts the original schema actor and legacy variant, refusing arbitrary SQL identifiers', () => {
    expect(normalizeQueueHistoryActorColumn('ActionByUserID')).toBe('ActionByUserID');
    expect(normalizeQueueHistoryActorColumn('UserID')).toBe('UserID');
    for (const value of ['', null, 'Foo', 'ActionByUserID]; DROP TABLE dbo.QueueTickets;--']) {
      expect(() => normalizeQueueHistoryActorColumn(value)).toThrow();
    }
  });

  it('uses column metadata and never a tenant-global hardcoded history user column', () => {
    const implementation = file('src/lib/queue/queueTicketHistoryActor.ts');
    const create = file('src/app/api/queue/route.ts');
    const modify = file('src/app/api/queue/[id]/route.ts');
    const migration = file('db/migrations/queue-booking-system.sql');

    expect(migration).toContain('[ActionByUserID]');
    expect(implementation).toContain("COL_LENGTH('dbo.QueueTicketHistory', 'ActionByUserID')");
    expect(implementation).toContain("COL_LENGTH('dbo.QueueTicketHistory', 'UserID')");
    expect(create).toContain('const actorColumn = await resolveQueueHistoryActorColumn(db);');
    expect(create).toContain('ActionType, [${actorColumn}])');
    expect(modify).toContain('const historyActorColumn = await resolveQueueHistoryActorColumn(db);');
    expect(modify).toContain('ActionType, [${historyActorColumn}], Notes)');
    expect(modify).toContain('u.UserID = h.[${actorColumn}]');
    expect(create).not.toContain('ActionType, UserID)');
    expect(modify).not.toContain('u.UserID = h.UserID');
  });
});
