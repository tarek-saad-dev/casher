import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const get = (p: string) => readFileSync(p, 'utf8');

describe('persistent POST /api/sales request token across both POS writers (#246)', () => {
  it('browser sends same UUID when saving same draft and only rotates it after confirmed successful sale', () => {
    const ui = get('src/app/income/pos/page.tsx');
    expect(ui).toContain('NEXT_PUBLIC_POS_SALE_IDEMPOTENCY_ENABLED');
    expect(ui).toContain('saleRequestIdRef.current ??');
    const token = get('src/lib/sales/clientSaleRequestId.ts');
    expect(token).toContain('crypto.randomUUID()');
    expect(token).toContain('window.sessionStorage');
    expect(ui).toContain('acquirePendingSaleRequestId(null)');
    expect(ui).toContain('clearPendingSaleRequestId()');
    expect(ui).toContain('hasUnresolvedSaleRequest()');
    expect(ui).toContain('window.confirm(');
    expect(ui).toContain('requestId: saleRequestIdRef.current');
    expect(ui).toContain('saleRequestIdRef.current = null;');
  });

  it('route looks up confirmed invoice BEFORE operational shift gates and never re-runs handoff on replay', () => {
    const route = get('src/app/api/sales/route.ts');
    const replay = route.indexOf('await lookupCommittedSaleReplay(');
    const gate = route.indexOf('await resolveBranchDayAndShiftForWrite(');
    const post = route.indexOf('await createSale(saleInput)');
    expect(replay).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(replay);
    expect(post).toBeGreaterThan(gate);
    expect(route).toContain('if (prior) return NextResponse.json(prior, { status: 200 })');
    expect(route).toContain('!result.replayed && Number.isInteger(handoffId)');
    expect(route).toContain('SaleIdempotencyError');
    expect(route).toContain('rawRequestId: body.requestId');
  });

  it('both independent writer paths reserve unique tenant request before financial posting', () => {
    for (const path of [
      'src/apps/pos/application/createSale.ts',
      'src/lib/sales/legacyRouteSaleCreate.ts',
    ]) {
      const s = get(path);
      const reserve = s.indexOf('await reserveSaleRequest(');
      const referral = s.indexOf('await prepareReferralSaleTransaction(');
      const invoice = s.indexOf('await execute');
      const reward = s.indexOf('await finalizeReferralSaleTransaction(');
      const done = s.indexOf('await completeSaleRequest(');
      const commit = s.indexOf('await transaction.commit();', done);
      expect(reserve).toBeGreaterThan(0);
      expect(referral).toBeGreaterThan(reserve);
      expect(invoice).toBeGreaterThan(referral);
      expect(reward).toBeGreaterThan(invoice);
      expect(done).toBeGreaterThan(reward);
      expect(commit).toBeGreaterThan(done);
      expect(s).toContain("if (saleRequest?.kind === 'replay')");
      expect(s).toContain('return saleRequest.result');
    }
  });

  it('schema enforces unique tenant/request pair and commits invoice identity atomically', () => {
    const sql = get('db/drvo-migrations/024-pos-sale-idempotency/schema.sql');
    const m = get('scripts/drvo/migrations/index.ts');
    expect(sql).toContain('PRIMARY KEY CLUSTERED (TenantId, RequestID)');
    expect(sql).toContain('CK_TblPosSaleRequest_Invoice');
    expect(sql).toContain('FK_TblPosSaleRequest_Tenant');
    expect(m).toContain('posSaleIdempotencyMigration,');
  });

  it('idempotency remains independent from referral issue flags and is OFF until SQL migration approval', () => {
    const server = get('src/lib/sales/saleRequestIdempotency.service.ts');
    expect(server).toContain("process.env.POS_SALE_IDEMPOTENCY_ENABLED === 'true'");
    expect(server).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(server).toContain('PayloadHash = @fingerprint');
    expect(server).toContain('confirmedInvoice(');
    expect(server).not.toContain('DB_PASSWORD');
  });
});
