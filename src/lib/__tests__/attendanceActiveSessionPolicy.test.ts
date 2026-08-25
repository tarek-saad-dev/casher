/**
 * Focused unit tests for WorkDate-scoped active OPEN session policy.
 */
import { describe, expect, it } from 'vitest';
import {
  classifyOpenSession,
  evaluateActiveOpenCreation,
  willResultInOpenSession,
  type OpenAttendanceSession,
} from '@/modules/attendance/domain/attendanceSessionPolicy';

function open(
  partial: Partial<OpenAttendanceSession> & Pick<OpenAttendanceSession, 'attendanceId' | 'workDate'>,
): OpenAttendanceSession {
  return {
    employeeId: 42,
    branchId: 20,
    checkInTime: '09:00',
    ...partial,
  };
}

describe('evaluateActiveOpenCreation', () => {
  it('allows when no open sessions', () => {
    const result = evaluateActiveOpenCreation({
      candidateWorkDate: '2026-08-24',
      openSessions: [],
    });
    expect(result).toMatchObject({
      allowed: true,
      kind: 'NO_SESSION',
      conflict: null,
      activeSessions: [],
      staleSessions: [],
    });
  });

  it('classifies same WorkDate as ACTIVE_OPEN and different as STALE_OPEN', () => {
    expect(classifyOpenSession('2026-08-24', '2026-08-24')).toBe('ACTIVE_OPEN');
    expect(classifyOpenSession('2026-08-01', '2026-08-24')).toBe('STALE_OPEN');
  });

  it('blocks same WorkDate other-branch ACTIVE_OPEN', () => {
    const conflict = open({
      attendanceId: 1,
      branchId: 20,
      workDate: '2026-08-24',
    });
    const result = evaluateActiveOpenCreation({
      candidateWorkDate: '2026-08-24',
      openSessions: [conflict],
    });
    expect(result.allowed).toBe(false);
    expect(result.kind).toBe('CONFLICT');
    expect(result.conflict).toEqual(conflict);
    expect(result.activeSessions).toHaveLength(1);
  });

  it('stale OPEN does not block', () => {
    const result = evaluateActiveOpenCreation({
      candidateWorkDate: '2026-08-24',
      openSessions: [
        open({ attendanceId: 1, workDate: '2026-08-01', branchId: 20 }),
        open({ attendanceId: 2, workDate: '2026-07-15', branchId: 30 }),
      ],
    });
    expect(result.allowed).toBe(true);
    expect(result.kind).toBe('STALE_OPEN');
    expect(result.conflict).toBeNull();
    expect(result.staleSessions).toHaveLength(2);
    expect(result.activeSessions).toHaveLength(0);
  });

  it('CLOSED other branch is not in openSessions input — allowed', () => {
    // Closed rows never appear in openSessions inventory.
    const result = evaluateActiveOpenCreation({
      candidateWorkDate: '2026-08-24',
      openSessions: [],
    });
    expect(result.allowed).toBe(true);
    expect(willResultInOpenSession('10:00', '18:00')).toBe(false);
    expect(willResultInOpenSession('10:00', null)).toBe(true);
  });

  it('excludeAttendanceId ignores the row being upserted', () => {
    const result = evaluateActiveOpenCreation({
      candidateWorkDate: '2026-08-24',
      openSessions: [
        open({ attendanceId: 7, branchId: 10, workDate: '2026-08-24' }),
      ],
      excludeAttendanceId: 7,
    });
    expect(result.allowed).toBe(true);
    expect(result.activeSessions).toHaveLength(0);
  });
});
