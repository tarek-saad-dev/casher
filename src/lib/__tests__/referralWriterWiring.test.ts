import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

describe('referral is atomic in BOTH POS invoice writers (#227)', () => {
  it.each([
    ['src/apps/pos/application/createSale.ts', 'executeLegacySaleCreateTransaction('],
    ['src/lib/sales/legacyRouteSaleCreate.ts', 'executeInRouteSaleCreateTransaction('],
  ])('%s obtains customer lock before invoice and rewards before commit', (path, executeMarker) => {
    const content = read(path);
    const transaction = content.lastIndexOf('export async function');
    const relevant = content.slice(transaction);
    const before = relevant.indexOf('await prepareReferralSaleTransaction(');
    const execute = relevant.indexOf('await ' + executeMarker);
    const after = relevant.indexOf('await finalizeReferralSaleTransaction(');
    // The first commit belongs to the READ-ONLY replay fast path.
    // Verify referral + idempotency financial completion precedes the final commit.
    const commit = relevant.lastIndexOf('await transaction.commit()');
    const idempotencyCommit = relevant.indexOf('await completeSaleRequest(');
    const rollback = relevant.indexOf('await transaction.rollback()');
    expect(before).toBeGreaterThanOrEqual(0);
    expect(execute).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(execute);
    expect(idempotencyCommit).toBeGreaterThan(after);
    expect(commit).toBeGreaterThan(idempotencyCommit);
    expect(rollback).toBeGreaterThan(commit);
    expect(relevant).toContain('clientId: input.clientId');
    expect(relevant).toContain('referralCode: input.referralCode');
    expect(relevant).toContain('tenantId: input.tenantId');
  });

  it('referral pricing is not delegated to the browser', () => {
    const route = read('src/app/api/sales/route.ts');
    expect(route).toContain('parseReferralCheckoutRequest(body.referralCode, body.clientId)');
    expect(route).toContain('priceFirstVisitReferral(lineItemsForTotals');
    expect(route).toContain('referralCode,');
    expect(route).toContain('tenantId: String(sessionUser.TenantId)');
  });
});
