import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { USER_OPEN_SHIFT_DISCOVERY_SQL } from '../internal/transactionReads';

describe('financial write lock order', () => {
  it('discovers the open shift without locking TblShiftMove before the day', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/shared/operational-calendar/internal/transactionReads.ts'),
      'utf8',
    );
    expect(source).toContain('query(USER_OPEN_SHIFT_DISCOVERY_SQL)');
    expect(source).not.toMatch(/TblShiftMove sm WITH \(UPDLOCK/);
    expect(USER_OPEN_SHIFT_DISCOVERY_SQL).toMatch(/WITH \(NOLOCK\)/);
    expect(USER_OPEN_SHIFT_DISCOVERY_SQL).not.toMatch(/UPDLOCK|HOLDLOCK|ROWLOCK/i);
    expect(USER_OPEN_SHIFT_DISCOVERY_SQL).toContain('TblShiftMove');
  });
});
