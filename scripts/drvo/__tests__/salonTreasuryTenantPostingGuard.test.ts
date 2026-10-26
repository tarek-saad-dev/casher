import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/apps/treasury/internal/postSaleCashMove.ts'), 'utf8',
);

describe('Treasury POS sale tenant authority', () => {
  it('fails closed on foreign actor tenant before reading replay registry or writing cash', () => {
    const guard = source.indexOf("actor.tenantId.toLowerCase() !== command.tenantId.toLowerCase()");
    const lookup = source.indexOf('const existing = await findRegistryByKey(');
    const insert = source.indexOf('return insertSaleCashMoveResolvingConflict(');
    expect(guard).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(guard);
    expect(insert).toBeGreaterThan(lookup);
    expect(source).toContain('Treasury sale post tenant context mismatch');
  });

  it('retains conflict fingerprint and transactional outbox handling', () => {
    expect(source).toContain('TreasuryIdempotencyConflictError');
    expect(source).toContain('SAVE TRANSACTION');
    expect(source).toContain('ROLLBACK TRANSACTION');
    expect(source).toContain('publishTreasuryOutboxEvent(');
  });
});
