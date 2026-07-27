import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('bookingCheckSlot route contract', () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), 'src/app/api/public/booking/check-slot/route.ts'),
    'utf8',
  );

  it('Phase 5 wire fields present', () => {
    expect(src).toContain('candidateBarbers');
    expect(src).toContain('assignmentStrategy');
    expect(src).toContain('dayOffset');
    expect(src).toContain('subtotal');
    expect(src).toContain('evaluationMode');
  });
});
