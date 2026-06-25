import { describe, it, expect } from 'vitest';
import { calculateChangedFields } from '@/lib/sensitiveActionDiff';

describe('calculateChangedFields', () => {
  it('returns null when both snapshots are null', () => {
    expect(calculateChangedFields(null, null)).toBeNull();
  });

  it('returns all fields as new when old is null', () => {
    const result = calculateChangedFields(null, { name: 'Ali', amount: 100 });
    expect(result).toEqual({
      name: { old: undefined, new: 'Ali' },
      amount: { old: undefined, new: 100 },
    });
  });

  it('returns all fields as removed when new is null', () => {
    const result = calculateChangedFields({ name: 'Ali', amount: 100 }, null);
    expect(result).toEqual({
      name: { old: 'Ali', new: undefined },
      amount: { old: 100, new: undefined },
    });
  });

  it('detects changed scalar fields', () => {
    const result = calculateChangedFields(
      { name: 'Ali', amount: 100, active: true },
      { name: 'Ali', amount: 200, active: false }
    );
    expect(result).toEqual({
      amount: { old: 100, new: 200 },
      active: { old: true, new: false },
    });
  });

  it('detects nested changes as whole values', () => {
    const result = calculateChangedFields(
      { header: { total: 100 }, items: [] },
      { header: { total: 150 }, items: [{ id: 1 }] }
    );
    expect(result).toEqual({
      header: { old: { total: 100 }, new: { total: 150 } },
      items: { old: [], new: [{ id: 1 }] },
    });
  });

  it('ignores unchanged fields', () => {
    const result = calculateChangedFields(
      { name: 'Ali', amount: 100 },
      { name: 'Ali', amount: 100 }
    );
    expect(result).toBeNull();
  });
});
