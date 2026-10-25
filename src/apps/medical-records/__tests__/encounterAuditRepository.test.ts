import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const query = vi.fn();
  const input = vi.fn();
  const request = { input, query };
  input.mockReturnValue(request);
  const getPool = vi.fn().mockResolvedValue({ request: () => request });
  const begin = vi.fn();
  const commit = vi.fn();
  const rollback = vi.fn().mockResolvedValue(undefined);
  return { query, input, request, getPool, begin, commit, rollback };
});

vi.mock('@/lib/db', () => ({
  getPool: db.getPool,
  sql: {
    UniqueIdentifier: 'uuid',
    Int: 'int',
    NVarChar: () => 'text',
    Transaction: class { begin = db.begin; commit = db.commit; rollback = db.rollback; },
    Request: class { constructor() { return db.request; } },
  },
}));

import { listEncounterAuditForClinician } from '../internal/encounterAuditRepository';
import { isAuthenticatedClinicalReader, isClinicUuid } from '../application/encounterAuditPolicy';

const input = {
  tenantId: 'e1b7fbd4-bb5b-470e-966f-99f68588e6cd',
  encounterId: 'bce7f7d8-952a-4fa0-829f-f27f364aa9cd',
  actor: { kind: 'human' as const, userId: 7, empId: 12 },
};

describe('tenant-protected clinic audit repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockReset().mockResolvedValue({ recordset: [] });
  });

  it('reads only assigned-doctor encounter events and writes a read-audit atomically', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ EncounterId: input.encounterId }] });
    db.query.mockResolvedValueOnce({ recordset: [{
      AuditId: 2, Action: 'opened', ActorUserID: 7,
      CreatedAt: new Date('2026-10-25T00:00:00Z'),
      MetadataJson: '{"sensitive":"must never return"}',
    }] });
    const result = await listEncounterAuditForClinician(input);
    expect(result).toEqual([{
      auditId: 2, action: 'opened', actorUserId: 7,
      createdAt: new Date('2026-10-25T00:00:00Z'),
    }]);
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(db.input).toHaveBeenCalledWith('tenantId', 'uuid', input.tenantId);
    expect(db.input).toHaveBeenCalledWith('encounterId', 'uuid', input.encounterId);
    expect(db.input).toHaveBeenCalledWith('empId', 'int', 12);
    expect(db.input).toHaveBeenCalledWith('userId', 'int', 7);
    const sqlText = db.query.mock.calls.map(([query]: [string]) => query);
    expect(sqlText).toHaveLength(3);
    expect(sqlText[0]).toMatch(/e\.TenantId=@tenantId/);
    expect(sqlText[0]).toMatch(/doctor\.UserID=@userId/);
    expect(sqlText[0]).toMatch(/e\.PractitionerEmpID=@empId/);
    expect(sqlText[1]).toMatch(/EntityType=N'encounter'/);
    expect(sqlText[1]).toMatch(/TenantId=@tenantId/);
    expect(sqlText[1]).not.toMatch(/SELECT[^;]*MetadataJson/s);
    expect(sqlText[2]).toContain("N'audit-read'");
    expect(db.commit).toHaveBeenCalledOnce();
    expect(db.rollback).not.toHaveBeenCalled();
  });

  it('returns identical null for a missing/foreign/unassigned encounter without reading history', async () => {
    expect(await listEncounterAuditForClinician(input)).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.rollback).toHaveBeenCalledOnce();
    expect(db.commit).not.toHaveBeenCalled();
  });

  it('rolls back when recording the audit read fails and never returns unaudited data', async () => {
    db.query.mockResolvedValueOnce({ recordset: [{ EncounterId: input.encounterId }] });
    db.query.mockResolvedValueOnce({ recordset: [{ AuditId: 2 }] });
    db.query.mockRejectedValueOnce(new Error('Audit write unavailable'));
    await expect(listEncounterAuditForClinician(input)).rejects.toThrow('Audit write unavailable');
    expect(db.commit).not.toHaveBeenCalled();
    expect(db.rollback).toHaveBeenCalledOnce();
  });

  it('rejects an AI actor before opening a database connection', async () => {
    expect(await listEncounterAuditForClinician({
      ...input, actor: { kind: 'ai', agentId: 'bot' },
    })).toBeNull();
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it('validates tenant and visit UUIDs before SQL binding', async () => {
    expect(await listEncounterAuditForClinician({ ...input, tenantId: 'tenant-a' })).toBeNull();
    expect(await listEncounterAuditForClinician({ ...input, encounterId: 'visit-a' })).toBeNull();
    expect(db.getPool).not.toHaveBeenCalled();
  });

  it('rejects impersonation and invalid clinical principal IDs', () => {
    expect(isAuthenticatedClinicalReader({ kind: 'human', userId: 8, empId: 12 }, 7)).toBe(false);
    expect(isAuthenticatedClinicalReader({ kind: 'human', userId: 7, empId: 0 }, 7)).toBe(false);
    expect(isAuthenticatedClinicalReader({ kind: 'human', userId: 7, empId: 12 }, 7)).toBe(true);
    expect(isClinicUuid(input.encounterId)).toBe(true);
    expect(isClinicUuid('not-a-uuid')).toBe(false);
  });
});
