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

  it('stacked #248 staging gate runs BOTH 023 referral and 024 idempotency smokes', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const step023 = gate.slice(
      gate.indexOf('- name: DRVO-023 tenant referral SQL / concurrency smoke'),
      gate.indexOf('- name: DRVO-024 POS sale idempotency SQL smoke'),
    );
    expect(step023).toContain("github.event.pull_request.head.ref == 'feat/pos-sale-idempotency-246'");
    expect(step023).toContain('scripts/drvo/drvo023-referral-staging-smoke.ts');
    const step024 = gate.slice(gate.indexOf('- name: DRVO-024 POS sale idempotency SQL smoke'));
    expect(step024).toContain('scripts/drvo/drvo024-sale-idempotency-staging-smoke.ts');

    const smoke = get('scripts/drvo/drvo024-sale-idempotency-staging-smoke.ts');
    expect(smoke).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(smoke).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(smoke).toContain('LOCK_TIMEOUT 1500');
    expect(smoke).toContain('ErrorNumber) === 1222');
    expect(smoke).toContain('await first.rollback()');
    expect(smoke).toContain('await second.rollback()');
  });

  it('validates committed branch/Location pairs without NOLOCK dirty-read false orphans', () => {
    const file = get('scripts/drvo/platformBootstrap.ts');
    const start = file.indexOf('const branchMappings = await pool.request().query(');
    const end = file.indexOf('const mem = await pool', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const section = file.slice(start, end);
    expect(section).toContain('WITH (READCOMMITTEDLOCK)');
    expect(section).toContain('WHERE l.LegacyBranchId = b.BranchID');
    expect(section).not.toContain('NOLOCK');
    expect(section).toContain('Unmapped legacy branch');
  });

  it('runs #248 DRVO-012 repair BEFORE a fail-closed full verification', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const repair = gate.indexOf('name: Reconcile missing DRVO-012 subscriptions on staging integration only');
    const verify = gate.indexOf('name: Verify DRVO after migration');
    const legacy = gate.indexOf('name: Reconcile grandfathered subscriptions if required');
    expect(repair).toBeGreaterThan(0);
    expect(verify).toBeGreaterThan(repair);
    expect(legacy).toBeGreaterThan(verify);
    const verifyGate = gate.slice(verify, legacy);
    expect(verifyGate).toContain("continue-on-error: ${{ github.event.pull_request.head.ref != 'feat/pos-sale-idempotency-246' }}");
    expect(gate.slice(legacy, gate.indexOf('name: DRVO-012 staging smoke'))).toContain("github.event.pull_request.head.ref != 'feat/pos-sale-idempotency-246'");
  });

  it('repairs missing DRVO-012 staging subscriptions before the integration smoke', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const fix = gate.indexOf('name: Reconcile missing DRVO-012 subscriptions on staging integration only');
    const smoke = gate.indexOf('name: DRVO-012 staging smoke');
    expect(fix).toBeGreaterThan(0);
    expect(smoke).toBeGreaterThan(fix);
    const guarded = gate.slice(fix, smoke);
    expect(guarded).toContain("github.event.pull_request.head.ref == 'feat/pos-sale-idempotency-246'");
    expect(guarded).toContain('--expected-database=last132_agent');
    expect(guarded).not.toContain('--allow-production');
    const script = get('scripts/drvo/drvo-012-reconcile-subscriptions.ts');
    expect(script).toContain('assertDatabaseAllowed(');
    expect(script).toContain('reconcileGrandfatheredSubscriptions(pool)');
  });

  it('financial staging audit is strictly staging-read-only and fails on real ledger discrepancies', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    expect(gate).toContain('CUT referral 248 financial ledger audit (staging read-only)');
    expect(gate).toContain('scripts/drvo/drvo248-referral-financial-audit-staging.ts');
    const code = get('scripts/drvo/drvo248-referral-financial-audit-staging.ts');
    expect(code).toContain("database: 'last132_agent'");
    expect(code).toContain("user: 'drvo_agent'");
    expect(code).toContain('InvalidAppliedInvoice');
    expect(code).toContain('MissingEarnedVoucher');
    expect(code).toContain('InvalidUsedInvoice');
    expect(code).toContain('InvalidCommittedRequest');
    expect(code).toContain('for (const name of defects)');
    expect(code).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?dbo\./i);
    expect(code).toContain('not an E2E proof');
  });

  it('runs actual both-writer POS paid-sale staging smoke after DRVO verification', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const post = gate.indexOf('name: CUT POS both-writer real sale staging smoke');
    const verify = gate.indexOf('name: Final DRVO verify');
    expect(post).toBeGreaterThan(verify);
    const excerpt = gate.slice(post, gate.indexOf('name: Report PASS'));
    expect(excerpt).toContain('scripts/drvo-008-pos-staging-smoke.ts');
    expect(excerpt).toContain("github.event.pull_request.head.ref == 'feat/pos-sale-idempotency-246'");
    expect(excerpt).toContain("WHATSAPP_SALE_ENABLED: 'false'");
  });

  it('runs both real POS SQL executors for 50/20 with guaranteed rollback', () => {
    const gate = get('.github/workflows/drvo-staging-gate.yml');
    const smoke = get('scripts/drvo/drvo248-referral-transaction-e2e-staging.ts');
    expect(gate).toContain('CUT referral 248 SQL 50-20 both-writer transaction E2E (ROLLBACK)');
    expect(gate).toContain('scripts/drvo/drvo248-referral-transaction-e2e-staging.ts');
    expect(smoke).toContain('executeInRouteSaleCreateTransaction');
    expect(smoke).toContain('executeLegacySaleCreateTransaction');
    expect(smoke).toContain('priceFirstVisitReferral(');
    expect(smoke).toContain('priceReferralRewardVoucher(');
    expect(smoke).toContain('reverseReferralInvoiceOnFullRefund(');
    expect(smoke).toContain('completeSaleRequest(');
    expect(smoke).toContain('await localTx.rollback()');
    expect(smoke).toContain('if (tx && !wasRolledBack)');
    expect(smoke).toContain("DB_DATABASE: 'last132_agent'");
    expect(smoke).toContain("sql.ISOLATION_LEVEL.SERIALIZABLE");
    expect(smoke).toContain('NOT a full browser HTTP POST');
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
